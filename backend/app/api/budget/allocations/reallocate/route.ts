/**
 * POST /api/budget/allocations/reallocate — move budgeted dollars between two
 * envelopes for one month.
 *
 * This is the only write path into envelope_allocations. The table was read by
 * /api/budget and lib/llm/context.ts from the start but never written by
 * anything, so per-month overrides could not exist and "Approve" on an LLM
 * action card logged to the console.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { budgetEnvelopes, envelopeAllocations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { planReallocation } from "@/lib/budget/reallocate";
import { coerceInteger, readJsonObject } from "@/lib/request-body";

/**
 * envelope_allocations is keyed by (envelope, year, month), so an out-of-range
 * year creates a per-month override for a month that cannot be viewed or
 * corrected. Bounded rather than merely integer-checked.
 */
const MIN_YEAR = 1970;
const MAX_YEAR = 9999;

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const userId = authed.userId;
  const body = await readJsonObject(req);
  if (!body) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const now = new Date();
  // `Number(body.year)` was the previous coercion, and `Number([])` is 0 — so
  // {"year": []} wrote an allocation row for year 0 and returned 200.
  const year = body.year == null ? now.getFullYear() : coerceInteger(body.year);
  const month = body.month == null ? now.getMonth() + 1 : coerceInteger(body.month);
  if (
    year === null ||
    month === null ||
    year < MIN_YEAR ||
    year > MAX_YEAR ||
    month < 1 ||
    month > 12
  ) {
    return NextResponse.json({ error: "year and month must be a valid month" }, { status: 400 });
  }

  const [envelopes, allocations] = await Promise.all([
    db
      .select({
        id: budgetEnvelopes.id,
        name: budgetEnvelopes.name,
        monthlyTarget: budgetEnvelopes.monthlyTarget,
      })
      .from(budgetEnvelopes)
      // Inactive envelopes are excluded so a reallocation can't resurrect
      // budget into an envelope the user has deleted.
      .where(and(eq(budgetEnvelopes.userId, userId), eq(budgetEnvelopes.active, 1))),
    db
      .select({
        envelopeId: envelopeAllocations.envelopeId,
        allocated: envelopeAllocations.allocated,
      })
      .from(envelopeAllocations)
      .where(
        and(
          eq(envelopeAllocations.userId, userId),
          eq(envelopeAllocations.year, year),
          eq(envelopeAllocations.month, month)
        )
      ),
  ]);

  const result = planReallocation({
    envelopes,
    allocations,
    fromName: body.envelope_from,
    toName: body.envelope_to,
    amount: body.amount,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const { plan } = result;

  // Both sides in one transaction: a half-applied move would create or destroy
  // budgeted money, which is exactly what a reallocation must never do.
  await db.transaction(async (tx) => {
    for (const side of [plan.from, plan.to]) {
      await tx
        .insert(envelopeAllocations)
        .values({
          id: randomUUID(),
          userId,
          envelopeId: side.envelopeId,
          year,
          month,
          allocated: side.after,
        })
        // uq_envelope_year_month makes this an idempotent upsert; without it a
        // second reallocation touching the same envelope would insert a
        // duplicate row and /api/budget would read whichever came back first.
        .onConflictDoUpdate({
          target: [
            envelopeAllocations.envelopeId,
            envelopeAllocations.year,
            envelopeAllocations.month,
          ],
          set: { allocated: side.after },
        });
    }
  });

  return NextResponse.json({ ok: true, year, month, ...plan });
}
