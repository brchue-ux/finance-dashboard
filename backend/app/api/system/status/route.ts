/**
 * GET /api/system/status — end-user trust signals (spec §9 Settings item 4).
 * Not logs: per-connection sync freshness, alert-engine heartbeat, last
 * nightly analysis, import history.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { bankConnections, wealthsimpleConnections, jobRuns } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { inPollingWindow } from "@/lib/alerts/poller";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const [banks, [ws], [lastPoll], [lastNightly], imports] = await Promise.all([
    db
      .select({
        institution: bankConnections.institutionName,
        status: bankConnections.status,
        lastSyncedAt: bankConnections.lastSyncedAt,
      })
      .from(bankConnections)
      .where(eq(bankConnections.userId, userId)),
    db
      .select({
        status: wealthsimpleConnections.status,
        lastSyncedAt: wealthsimpleConnections.lastSyncedAt,
      })
      .from(wealthsimpleConnections)
      .where(eq(wealthsimpleConnections.userId, userId))
      .limit(1),
    db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.jobType, "alert_poll"))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1),
    db
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.jobType, "nightly_batch"), eq(jobRuns.userId, userId)))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1),
    db
      .select()
      .from(jobRuns)
      .where(
        and(
          eq(jobRuns.userId, userId),
          inArray(jobRuns.jobType, ["import_csv", "import_google_sheets", "import_excel"])
        )
      )
      .orderBy(desc(jobRuns.startedAt))
      .limit(10),
  ]);

  return NextResponse.json({
    connections: {
      banks,
      wealthsimple: ws ?? null,
    },
    alertEngine: {
      lastRunAt: lastPoll?.startedAt ?? null,
      lastRunStatus: lastPoll?.status ?? null,
      // Market-closed gaps are healthy, not stale (spec §9): the poller only
      // runs Mon–Fri ~4:00–20:00 ET. The UI should show "market closed" rather
      // than a stale warning whenever this is false.
      marketWindowOpenNow: inPollingWindow(),
    },
    nightlyAnalysis: {
      lastRunAt: lastNightly?.startedAt ?? null,
      lastRunStatus: lastNightly?.status ?? null,
    },
    importHistory: imports.map((j) => ({
      id: j.id,
      jobType: j.jobType,
      status: j.status,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      errorMessage: j.errorMessage,
      metadata: j.metadata ? JSON.parse(j.metadata) : null,
    })),
  });
}
