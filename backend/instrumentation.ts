/**
 * Next.js instrumentation hook — the sanctioned once-per-server-start entry
 * point. Registers in-process cron jobs (spec §5.6/§7).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCrons } = await import("@/lib/jobs/scheduler");
    startCrons();
  }
}
