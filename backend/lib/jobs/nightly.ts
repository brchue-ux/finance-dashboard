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
import { syncPlaidForUser } from "@/lib/sync/plaid";
import { syncSnapTradeForUser } from "@/lib/sync/snaptrade";
import { startJobRun, finishJobRun } from "@/lib/jobs/job-runs";

const MODEL = "claude-sonnet-4-6"; // keep in step with lib/llm/advisory.ts
const MAX_OUTPUT_TOKENS = 1500;

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

function batchTools() {
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
    // Same degradation rule as the sync path: no MCP service configured →
    // explicit no-fabrication clause instead of silently missing tools
    const systemSuffix = mcpServers ? "" : NO_INDICATOR_DATA_CLAUSE;

    const makeRequest = (view: "budget" | "portfolio", context: string) => ({
      custom_id: `${jobId}:${view}`,
      params: {
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT + context + systemSuffix,
        messages: [{ role: "user" as const, content: AUTO_CARD_INSTRUCTION }],
        tools: batchTools(),
        ...(mcpServers ? { mcp_servers: mcpServers } : {}),
      },
    });

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

      for await (const result of await anthropicClient.beta.messages.batches.results(meta.batchId)) {
        const view = result.custom_id.split(":").pop() as "budget" | "portfolio";
        if (result.result.type !== "succeeded") {
          failed++;
          console.error(`[nightly] batch item ${result.custom_id}: ${result.result.type}`);
          continue;
        }

        const text = result.result.message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("");
        try {
          const cards = (JSON.parse(text) as { cards: unknown[] }).cards;
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
        } catch {
          failed++;
          console.error(`[nightly] batch item ${result.custom_id}: invalid card JSON`);
        }
      }

      await finishJobRun(run.id, {
        status: failed > 0 && succeeded === 0 ? "failed" : "complete",
        metadata: { batchId: meta.batchId, succeeded, failed },
        ...(failed > 0 && succeeded === 0 ? { errorMessage: "all batch items failed" } : {}),
      });
    } catch (err) {
      console.error(`[nightly] polling batch ${meta.batchId} failed:`, err);
      // leave running — transient retrieve errors retry on the next poll
    }
  }
}
