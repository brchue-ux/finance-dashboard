/**
 * POST /api/llm/analyze
 * Auto-generates insight/action cards for Budget or Portfolio view.
 * Checks llm_analysis_cache first — only runs Claude if new data exists
 * since last analysis. Respects 2-minute debounce on re-analysis.
 *
 * Body: { view: "budget" | "portfolio", force?: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { llmAnalysisCache, bankConnections, wealthsimpleConnections } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateCards, type CardView } from "@/lib/llm/advisory";
import { v4 as uuidv4 } from "uuid";

const DEBOUNCE_SECONDS = 120;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { view, force = false } = (await req.json()) as { view: CardView; force?: boolean };
  const userId = session.user.id;
  const now = Math.floor(Date.now() / 1000);

  // Get last sync timestamp for this view's data source
  const lastSyncedAt = await getLastSyncedAt(userId, view);

  // Check cache
  const [cached] = await db
    .select()
    .from(llmAnalysisCache)
    .where(and(eq(llmAnalysisCache.userId, userId), eq(llmAnalysisCache.view, view)))
    .limit(1);

  if (cached && !force) {
    // Debounce: if analyzed within last 2 minutes, serve cache
    if (now - cached.lastAnalyzedAt < DEBOUNCE_SECONDS) {
      return NextResponse.json({
        cards: JSON.parse(cached.output),
        lastAnalyzedAt: cached.lastAnalyzedAt,
        cached: true,
      });
    }

    // No new data since last analysis → serve cache
    if (lastSyncedAt && cached.lastAnalyzedAt >= lastSyncedAt) {
      return NextResponse.json({
        cards: JSON.parse(cached.output),
        lastAnalyzedAt: cached.lastAnalyzedAt,
        cached: true,
      });
    }
  }

  const cards = await generateCards(userId, view);
  const output = JSON.stringify(cards);

  await db
    .insert(llmAnalysisCache)
    .values({
      id: cached?.id ?? uuidv4(),
      userId,
      view,
      lastAnalyzedAt: now,
      output,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [llmAnalysisCache.userId, llmAnalysisCache.view],
      set: { lastAnalyzedAt: now, output },
    });

  return NextResponse.json({ cards, lastAnalyzedAt: now, cached: false });
}

async function getLastSyncedAt(userId: string, view: CardView): Promise<number | null> {
  if (view === "budget") {
    const [conn] = await db
      .select({ lastSyncedAt: bankConnections.lastSyncedAt })
      .from(bankConnections)
      .where(eq(bankConnections.userId, userId))
      .limit(1);
    return conn?.lastSyncedAt ?? null;
  } else {
    const [conn] = await db
      .select({ lastSyncedAt: wealthsimpleConnections.lastSyncedAt })
      .from(wealthsimpleConnections)
      .where(eq(wealthsimpleConnections.userId, userId))
      .limit(1);
    return conn?.lastSyncedAt ?? null;
  }
}
