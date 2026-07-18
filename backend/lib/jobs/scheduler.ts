/**
 * In-process cron registration (spec §7 cron inventory). Called once per server
 * start from instrumentation.ts. Every job records itself in job_runs.
 */
import cron from "node-cron";
import { runPollCycle } from "@/lib/alerts/poller";
import { runNightly, pollPendingBatches } from "@/lib/jobs/nightly";

let started = false;

export function startCrons(): void {
  if (started) return; // instrumentation can run more than once in dev
  started = true;

  // Alert poller — every 5 minutes; the poller itself exits outside the
  // Mon–Fri ET window and gates per-symbol on marketState
  cron.schedule("*/5 * * * *", () => {
    void runPollCycle();
  });

  // Nightly pipeline — 2am local server time: sync all sources, submit
  // auto-card generation to the Batch API
  cron.schedule("0 2 * * *", () => {
    void runNightly();
  });

  // Batch collector — every 10 minutes; no-op unless a batch is pending
  cron.schedule("*/10 * * * *", () => {
    void pollPendingBatches();
  });

  console.log("[scheduler] crons registered: alert_poll (*/5), nightly (0 2), batch_poll (*/10)");
}
