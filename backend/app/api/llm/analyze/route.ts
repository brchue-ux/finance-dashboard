/**
 * POST /api/llm/analyze
 * Auto-generates insight/action cards for Budget or Portfolio view.
 * Checks llm_analysis_cache first — only runs Claude if new data exists
 * since last analysis. Respects 2-minute debounce on re-analysis.
 *
 * Body: { view: "budget" | "portfolio", force?: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { llmAnalysisCache, bankConnections, wealthsimpleConnections } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateCards, type CardView } from "@/lib/llm/advisory";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

const DEBOUNCE_SECONDS = 120;

/**
 * `view` is not just a discriminator — it is half of llm_analysis_cache's
 * unique index, so an unvalidated value would be written straight into the
 * cache as a new key. It was previously only cast (`as CardView`), which is a
 * compile-time claim about runtime input.
 */
const analyzeBody = z.object({
  view: z.enum(["budget", "portfolio"]),
  force: z.boolean().optional().default(false),
});

/**
 * Card generation takes tens of seconds — it is an agentic model call, not a
 * query, and no amount of tuning brings it near interactive latency. So a
 * cached answer is ALWAYS served immediately when one exists, and a stale one
 * is refreshed behind the response. The client polls while `refreshing` is
 * true and swaps the new cards in when they land.
 *
 * Only a genuine cold start (no cache at all) blocks.
 *
 * In-flight keys dedupe concurrent regenerations: without this, every screen
 * open during the ~30s window starts another full-price generation of the
 * same cards. This backend is a persistent process (Railway / next dev), so
 * module state and post-response work are both sound here; it would need a
 * queue or a durable lock on a serverless deployment.
 */
const refreshing = new Set<string>();

function refreshInBackground(userId: string, view: CardView) {
  const key = `${userId}:${view}`;
  if (refreshing.has(key)) return false;
  refreshing.add(key);

  void (async () => {
    try {
      const cards = await generateCards(userId, view);
      const at = Math.floor(Date.now() / 1000);
      const output = JSON.stringify(cards);
      await db
        .insert(llmAnalysisCache)
        .values({ id: uuidv4(), userId, view, lastAnalyzedAt: at, output, createdAt: at })
        .onConflictDoUpdate({
          target: [llmAnalysisCache.userId, llmAnalysisCache.view],
          set: { lastAnalyzedAt: at, output },
        });
    } catch (err) {
      // Swallow: the user still has their cached cards. Surfacing a failed
      // background refresh as a broken screen would be worse than stale data.
      console.error(`[llm/analyze] background refresh failed for ${key}:`, err);
    } finally {
      refreshing.delete(key);
    }
  })();

  return true;
}

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  // A malformed or empty body is a client error, not a server one: an
  // unguarded req.json() turned both into a 500.
  const raw = await req.json().catch(() => null);
  const parsed = analyzeBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "view must be one of: budget, portfolio", code: "INVALID_BODY" },
      { status: 400 }
    );
  }
  const { view, force } = parsed.data;

  const userId = authed.userId;
  const now = Math.floor(Date.now() / 1000);

  // Get last sync timestamp for this view's data source
  const lastSyncedAt = await getLastSyncedAt(userId, view);

  // Check cache
  const [cached] = await db
    .select()
    .from(llmAnalysisCache)
    .where(and(eq(llmAnalysisCache.userId, userId), eq(llmAnalysisCache.view, view)))
    .limit(1);

  if (cached) {
    const withinDebounce = now - cached.lastAnalyzedAt < DEBOUNCE_SECONDS;
    const dataUnchanged = Boolean(lastSyncedAt && cached.lastAnalyzedAt >= lastSyncedAt);
    // The debounce still governs regeneration, so a burst of opens can't
    // trigger repeated work — but it no longer decides whether the user waits.
    const shouldRefresh = (force || !dataUnchanged) && !withinDebounce;

    return NextResponse.json({
      cards: JSON.parse(cached.output),
      lastAnalyzedAt: cached.lastAnalyzedAt,
      cached: true,
      refreshing: shouldRefresh ? refreshInBackground(userId, view) : false,
    });
  }

  // Cold start only: nothing to show, so this one has to block. Unlike the
  // background path there is no cached answer to fall back on, so a missing
  // ANTHROPIC_API_KEY or a provider outage has to be reported — as 503
  // "not configured / unavailable", matching what the import routes already
  // return for the same shape of problem, rather than a bare 500.
  let cards;
  try {
    cards = await generateCards(userId, view);
  } catch (err) {
    console.error(`[llm/analyze] cold-start generation failed for ${userId}:${view}:`, err);
    return NextResponse.json(
      { error: "Analysis is unavailable right now", code: "ANALYSIS_UNAVAILABLE" },
      { status: 503 }
    );
  }
  const output = JSON.stringify(cards);

  await db
    .insert(llmAnalysisCache)
    .values({ id: uuidv4(), userId, view, lastAnalyzedAt: now, output, createdAt: now })
    .onConflictDoUpdate({
      target: [llmAnalysisCache.userId, llmAnalysisCache.view],
      set: { lastAnalyzedAt: now, output },
    });

  return NextResponse.json({ cards, lastAnalyzedAt: now, cached: false, refreshing: false });
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
