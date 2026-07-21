/**
 * Nightly 2am pipeline (spec §7): sync all data sources for every user, then
 * submit Budget + Portfolio auto-card generation to Anthropic's Batch API at
 * 50% token pricing. A separate poller cron collects finished batches into
 * llm_analysis_cache.
 *
 * Batch requests use the raw @anthropic-ai/sdk (the AI SDK has no batch
 * support) and declare SERVER tools — web search + the mcp_servers connector
 * pointing at the self-hosted Twelve Data MCP service — because a batch item
 * is a single completed server-side turn: client-executed tool loops are
 * impossible inside it, but Anthropic's batch worker runs server tools in its
 * own agentic loop (verified against Anthropic docs, decision log).
 */
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { user, jobRuns, llmAnalysisCache } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { SYSTEM_PROMPT, AUTO_CARD_INSTRUCTION } from "@/lib/llm/prompts";
import { assembleBudgetContext, assemblePortfolioContext } from "@/lib/llm/context";
import { NO_INDICATOR_DATA_CLAUSE } from "@/lib/llm/tools";
import { parseCards } from "@/lib/llm/parse-cards";
import { syncPlaidForUser } from "@/lib/sync/plaid";
import { syncSnapTradeForUser } from "@/lib/sync/snaptrade";
import { startJobRun, finishJobRun } from "@/lib/jobs/job-runs";

const MODEL = "claude-sonnet-4-6"; // keep in step with lib/llm/advisory.ts

// Server tools emit their `server_tool_use` blocks into this same output
// budget. At 1500 a real batch item spent the entire budget on a web_search
// call and ended `stop_reason: "max_tokens"` having produced zero text.
// Batch items have no HTTP timeout to stay under, so the ceiling only needs to
// bound cost.
const MAX_OUTPUT_TOKENS = 16000;

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/**
 * Mirrors assembleTools()'s purpose split: budget cards are arithmetic over the
 * user's own transactions and need no outside data, so they declare no tools.
 * Keeping this in step with lib/llm/tools.ts matters — the two paths generate
 * the same cards and would otherwise diverge in content and cost.
 */
function batchTools(view: "budget" | "portfolio") {
  if (view === "budget") return [];
  return [
    { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 5 },
  ];
}

function batchMcpServers() {
  const url = process.env.MCP_SERVICE_URL;
  if (!url) return undefined;
  return [
    {
      type: "url" as const,
      name: "twelvedata",
      url,
      ...(process.env.MCP_SERVICE_TOKEN
        ? { authorization_token: process.env.MCP_SERVICE_TOKEN }
        : {}),
    },
  ];
}

export async function runNightly(): Promise<void> {
  const users = await db.select({ id: user.id }).from(user);

  for (const u of users) {
    try {
      await syncPlaidForUser(u.id);
    } catch (err) {
      console.error(`[nightly] plaid sync failed for user ${u.id}:`, err);
    }
    try {
      await syncSnapTradeForUser(u.id);
    } catch (err) {
      console.error(`[nightly] snaptrade sync failed for user ${u.id}:`, err);
    }
    try {
      await submitCardBatch(u.id);
    } catch (err) {
      console.error(`[nightly] batch submit failed for user ${u.id}:`, err);
    }
  }
}

async function submitCardBatch(userId: string): Promise<void> {
  const jobId = await startJobRun("nightly_batch", userId);
  try {
    const [budgetContext, portfolioContext] = await Promise.all([
      assembleBudgetContext(userId),
      assemblePortfolioContext(userId),
    ]);

    const mcpServers = batchMcpServers();

    // custom_id must match Anthropic's ^[a-zA-Z0-9_-]{1,64}$ — no colon. jobId
    // is a hyphenated UUID (no underscore), so "_" is an unambiguous separator
    // for the pollPendingBatches() split below.
    const makeRequest = (view: "budget" | "portfolio", context: string) => {
      // Indicator tools and their no-fabrication clause are portfolio-only:
      // attaching an MCP server to the budget request would reintroduce the
      // tool loop the purpose split exists to remove, and claiming indicator
      // data is "unavailable" there would be false rather than protective.
      const useOutsideData = view === "portfolio";
      const servers = useOutsideData ? mcpServers : undefined;
      const systemSuffix = useOutsideData && !servers ? NO_INDICATOR_DATA_CLAUSE : "";
      return {
        custom_id: `${jobId}_${view}`,
        params: {
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SYSTEM_PROMPT + context + systemSuffix,
          messages: [{ role: "user" as const, content: AUTO_CARD_INSTRUCTION }],
          tools: batchTools(view),
          ...(servers ? { mcp_servers: servers } : {}),
        },
      };
    };

    const batch = await anthropicClient.beta.messages.batches.create({
      requests: [
        makeRequest("budget", budgetContext),
        makeRequest("portfolio", portfolioContext),
      ],
    });

    // Leave the run "running" with the batch id — the poller cron completes it
    await db
      .update(jobRuns)
      .set({ metadata: JSON.stringify({ batchId: batch.id }) })
      .where(eq(jobRuns.id, jobId));
  } catch (err) {
    await finishJobRun(jobId, {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Poller cron: collect finished batches into llm_analysis_cache. */
export async function pollPendingBatches(): Promise<void> {
  const pending = await db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.jobType, "nightly_batch"), eq(jobRuns.status, "running")));

  for (const run of pending) {
    const meta = run.metadata ? (JSON.parse(run.metadata) as { batchId?: string }) : {};
    if (!meta.batchId) continue; // submit crashed before recording the id; nothing to collect

    try {
      const batch = await anthropicClient.beta.messages.batches.retrieve(meta.batchId);
      if (batch.processing_status !== "ended") continue;

      const now = Math.floor(Date.now() / 1000);
      let succeeded = 0;
      let failed = 0;
      // Per-item outcomes. Previously an item failure logged only its result
      // type to the console and metadata carried bare counts, so a failing
      // nightly left nothing on disk to diagnose from.
      const items: { view: string; outcome: string; detail?: string }[] = [];

      for await (const result of await anthropicClient.beta.messages.batches.results(meta.batchId)) {
        const view = result.custom_id.split("_").pop() as "budget" | "portfolio";

        if (result.result.type !== "succeeded") {
          failed++;
          // `error` is the API's error *envelope*; the type/message sit inside it.
          const detail =
            result.result.type === "errored"
              ? `${result.result.error.error.type}: ${result.result.error.error.message}`
              : undefined;
          items.push({ view, outcome: result.result.type, ...(detail ? { detail } : {}) });
          console.error(`[nightly] batch item ${result.custom_id}: ${result.result.type}`, detail ?? "");
          continue;
        }

        const message = result.result.message;
        const text = message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("");

        try {
          const cards = parseCards(text);
          await db
            .insert(llmAnalysisCache)
            .values({
              id: uuidv4(),
              userId: run.userId!,
              view,
              lastAnalyzedAt: now,
              output: JSON.stringify(cards),
              createdAt: now,
            })
            .onConflictDoUpdate({
              target: [llmAnalysisCache.userId, llmAnalysisCache.view],
              set: { lastAnalyzedAt: now, output: JSON.stringify(cards) },
            });
          succeeded++;
          items.push({ view, outcome: "ok", detail: `${cards.length} cards` });
        } catch (err) {
          failed++;
          // stop_reason distinguishes a truncated response from a model that
          // finished but emitted something unparseable — different fixes.
          const detail = `stop_reason=${message.stop_reason}; ${
            err instanceof Error ? err.message : String(err)
          }`;
          items.push({ view, outcome: "unusable_output", detail });
          console.error(`[nightly] batch item ${result.custom_id}: ${detail}`);
        }
      }

      // A run that produced only some of its cards is not "complete" — the
      // old rule reported complete whenever a single item succeeded, so a
      // half-failing nightly showed green on Settings → System status.
      const status = failed === 0 ? "complete" : succeeded === 0 ? "failed" : "partial";

      await finishJobRun(run.id, {
        status,
        metadata: { batchId: meta.batchId, succeeded, failed, items },
        ...(failed > 0
          ? {
              errorMessage: items
                .filter((i) => i.outcome !== "ok")
                .map((i) => `${i.view}: ${i.outcome}${i.detail ? ` (${i.detail})` : ""}`)
                .join(" | "),
            }
          : {}),
      });
    } catch (err) {
      console.error(`[nightly] polling batch ${meta.batchId} failed:`, err);
      // leave running — transient retrieve errors retry on the next poll
    }
  }
}
