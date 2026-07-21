/**
 * GET /api/system/jobs?jobType=alert_poll&status=failed&limit=50
 * Developer screen's job_runs browser (spec §9 Settings item 5). Reads the DB
 * only — deep debugging stays in Railway's own log viewer.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { jobRuns } from "@/db/schema";
import { and, desc, eq, type SQL } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const { searchParams } = new URL(req.url);
  const jobType = searchParams.get("jobType");
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  const filters: SQL[] = [];
  if (jobType) filters.push(eq(jobRuns.jobType, jobType));
  if (status) filters.push(eq(jobRuns.status, status));

  const rows = await db
    .select()
    .from(jobRuns)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit);

  return NextResponse.json({
    jobs: rows.map((j) => ({
      ...j,
      metadata: j.metadata ? JSON.parse(j.metadata) : null,
    })),
  });
}
