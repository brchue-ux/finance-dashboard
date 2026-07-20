/**
 * job_runs writer — the observability spine. Every background execution records
 * a row here (spec §4/§7). Metadata rule: capture every data point available
 * per run; trim later, can't backfill.
 */
import { db } from "@/db";
import { jobRuns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export type JobType =
  | "plaid_sync"
  | "snaptrade_sync"
  | "alert_poll"
  | "nightly_batch"
  | "import_csv"
  | "import_google_sheets"
  | "import_excel"
  | "tradingview_webhook"
  | "graph_subscription_renewal"
  | "recategorize";

export async function startJobRun(jobType: JobType, userId?: string): Promise<string> {
  const id = uuidv4();
  await db.insert(jobRuns).values({
    id,
    userId: userId ?? null,
    jobType,
    status: "running",
    startedAt: Math.floor(Date.now() / 1000),
  });
  return id;
}

export async function finishJobRun(
  id: string,
  outcome: { status: "complete" | "failed"; errorMessage?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  await db
    .update(jobRuns)
    .set({
      status: outcome.status,
      finishedAt: Math.floor(Date.now() / 1000),
      errorMessage: outcome.errorMessage ?? null,
      metadata: outcome.metadata ? JSON.stringify(outcome.metadata) : null,
    })
    .where(eq(jobRuns.id, id));
}

/** Run fn inside a job_runs record — the common case for short jobs. */
export async function withJobRun<T>(
  jobType: JobType,
  fn: () => Promise<{ result?: T; metadata?: Record<string, unknown> }>,
  userId?: string
): Promise<T | undefined> {
  const id = await startJobRun(jobType, userId);
  try {
    const { result, metadata } = await fn();
    await finishJobRun(id, { status: "complete", metadata });
    return result;
  } catch (err) {
    await finishJobRun(id, {
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
