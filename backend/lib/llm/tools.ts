/**
 * LLM tool assembly (spec §8 Tool Use).
 *
 * - Web search: Anthropic's provider-executed tool — their servers search,
 *   billed through the same API call. Always available.
 * - Indicators: self-hosted twelvedata/mcp via a persistent module-level
 *   @ai-sdk/mcp client (this backend is a persistent Railway process).
 *
 * Degradation is precise, not "fall back to web search": MCP is the sole
 * source of computed indicator numbers. If the MCP service is unreachable its
 * tools are omitted from the call and the system prompt gains an explicit
 * no-fabrication instruction. Web search is a separate tool for a separate
 * purpose and stays available regardless.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";

export const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Twelve Data free tier: 800 credits/day AND 8 calls/min. The per-minute cap
// is the realistic risk with the model deciding when to call — hold each
// session well under it. Tune after real usage (spec §11 item 7).
const MAX_INDICATOR_CALLS_PER_SESSION = 4;

export const NO_INDICATOR_DATA_CLAUSE = `

INDICATOR DATA UNAVAILABLE:
The live technical-indicator service is currently unreachable. Do NOT estimate,
recall, or derive specific indicator values (RSI, MACD, moving averages, volume
statistics) from web search or any other source — omit precise indicator
numbers entirely and say the live data is temporarily unavailable if asked.`;

let mcpClient: MCPClient | null = null;

async function getMcpClient(): Promise<MCPClient | null> {
  const url = process.env.MCP_SERVICE_URL;
  if (!url) return null;
  if (mcpClient) return mcpClient;
  try {
    mcpClient = await createMCPClient({
      transport: {
        type: "http",
        url,
        ...(process.env.MCP_SERVICE_TOKEN
          ? { headers: { Authorization: `Bearer ${process.env.MCP_SERVICE_TOKEN}` } }
          : {}),
      },
      onUncaughtError: () => {
        // Force a reconnect attempt on the next call rather than reusing a dead client
        mcpClient = null;
      },
    });
    return mcpClient;
  } catch (err) {
    console.warn("[llm/tools] MCP service unreachable, indicator tools omitted:", err);
    mcpClient = null;
    return null;
  }
}

/** Per-session cap: wrap each MCP tool's execute so one advisory session can't burn the rate limit. */
function capToolCalls(tools: ToolSet, maxCalls: number): ToolSet {
  let calls = 0;
  const capped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    capped[name] = {
      ...tool,
      execute: async (input, options) => {
        if (++calls > maxCalls) {
          return `Indicator lookup limit reached for this session (${maxCalls} calls). Work with the data already retrieved.`;
        }
        return tool.execute!(input, options);
      },
    };
  }
  return capped;
}

/**
 * What the tools are being assembled for. Budget card generation gets none:
 * its output is arithmetic over the user's own transactions, and measurement
 * showed the tool loop was the dominant cost of the wait — 143.9s with web
 * search vs 30.7s without, on identical context. Nothing in the generated
 * budget cards (merchant frequency, category averages, spend spikes) came
 * from the web. Market data is equally irrelevant there.
 *
 * Portfolio cards and chat keep full access: current prices, news and
 * computed indicators genuinely require outside data.
 */
export type ToolPurpose = "budget-cards" | "portfolio-cards" | "chat";

export async function assembleTools(
  purpose: ToolPurpose = "chat"
): Promise<{ tools: ToolSet; systemSuffix: string }> {
  if (purpose === "budget-cards") {
    // No indicator clause: the service isn't unavailable, it's inapplicable,
    // and telling the model otherwise would be false.
    return { tools: {}, systemSuffix: "" };
  }

  const tools: ToolSet = {
    web_search: anthropic.tools.webSearch_20260209({ maxUses: 5 }),
  };

  const client = await getMcpClient();
  if (!client) {
    return { tools, systemSuffix: NO_INDICATOR_DATA_CLAUSE };
  }

  try {
    const mcpTools = await client.tools();
    return {
      tools: { ...tools, ...capToolCalls(mcpTools, MAX_INDICATOR_CALLS_PER_SESSION) },
      systemSuffix: "",
    };
  } catch (err) {
    console.warn("[llm/tools] MCP tools() failed, indicator tools omitted:", err);
    mcpClient = null; // reconnect next call
    return { tools, systemSuffix: NO_INDICATOR_DATA_CLAUSE };
  }
}
