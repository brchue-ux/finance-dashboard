/**
 * GET  /api/transfers/patterns — the user's saved transfer patterns, plus the
 *      shipped suggestions they haven't saved, each with live match counts so
 *      approval is informed consent, not a blind toggle.
 * POST /api/transfers/patterns { pattern } — save + retro-mark matching
 *      unmarked rows as transfers (transferSource='rule'). Manual marks are
 *      never touched. Returns how many rows it marked.
 *
 * Propose, don't impose: nothing here runs until the user approves a pattern,
 * and SUGGESTED_TRANSFER_PATTERNS are surfaced as proposals with counts —
 * exactly the learned-rules contract, applied to transfers.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { transactions, transferPatterns } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  matchesTransferPattern,
  rowsToMark,
  SUGGESTED_TRANSFER_PATTERNS,
} from "@/lib/budget/transfers";
import { v4 as uuidv4 } from "uuid";

async function loadRows(userId: string) {
  return db
    .select({
      id: transactions.id,
      description: transactions.description,
      transferSource: transactions.transferSource,
    })
    .from(transactions)
    .where(eq(transactions.userId, userId));
}

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const [saved, rows] = await Promise.all([
    db.select().from(transferPatterns).where(eq(transferPatterns.userId, authed.userId)),
    loadRows(authed.userId),
  ]);

  const savedSet = new Set(saved.map((p) => p.pattern.toLowerCase()));
  const suggestions = SUGGESTED_TRANSFER_PATTERNS.filter(
    (s) => !savedSet.has(s.pattern.toLowerCase())
  ).map((s) => ({
    ...s,
    // Rows this suggestion WOULD mark if approved (unmarked matches only).
    wouldMark: rowsToMark(rows, s.pattern).length,
    // Rows already matching but marked (by script or another pattern) — shown
    // so a zero wouldMark doesn't read as "useless pattern".
    alreadyMarked: rows.filter(
      (r) => r.transferSource && matchesTransferPattern(r.description, [s.pattern])
    ).length,
  }));

  return NextResponse.json({
    patterns: saved.map((p) => ({
      id: p.id,
      pattern: p.pattern,
      catchesAtCreation: p.catchesAtCreation,
      currentMatches: rows.filter((r) => matchesTransferPattern(r.description, [p.pattern]))
        .length,
    })),
    suggestions,
  });
}

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const body = (await req.json().catch(() => null)) as { pattern?: unknown } | null;
  const pattern = typeof body?.pattern === "string" ? body.pattern.trim() : "";
  if (!pattern) return NextResponse.json({ error: "pattern is required" }, { status: 400 });

  const existing = await db
    .select({ id: transferPatterns.id, pattern: transferPatterns.pattern })
    .from(transferPatterns)
    .where(eq(transferPatterns.userId, authed.userId));
  if (existing.some((p) => p.pattern.toLowerCase() === pattern.toLowerCase())) {
    return NextResponse.json({ error: "pattern already saved" }, { status: 409 });
  }

  const rows = await loadRows(authed.userId);
  const toMark = rowsToMark(rows, pattern);

  const id = uuidv4();
  await db.insert(transferPatterns).values({
    id,
    userId: authed.userId,
    pattern,
    catchesAtCreation: toMark.length,
    createdAt: Math.floor(Date.now() / 1000),
  });
  if (toMark.length > 0) {
    await db
      .update(transactions)
      .set({ transferSource: "rule" })
      .where(inArray(transactions.id, toMark.map((r) => r.id)));
  }

  return NextResponse.json({ ok: true, id, pattern, marked: toMark.length });
}
