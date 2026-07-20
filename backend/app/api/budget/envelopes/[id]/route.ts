/**
 * PATCH  /api/budget/envelopes/:id — edit name/target/rules/order/active
 * DELETE /api/budget/envelopes/:id — deactivate (soft)
 *
 * Delete is soft on purpose: envelope_allocations rows reference the envelope,
 * and past transactions carry the envelope *name* as their category, so a hard
 * delete would orphan allocations and silently rewrite spending history.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { budgetEnvelopes } from "@/db/schema";
import { and, eq } from "drizzle-orm";

async function ownedEnvelope(req: NextRequest, id: string) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return { error: "Unauthorized" as const, status: 401 };

  const [row] = await db
    .select()
    .from(budgetEnvelopes)
    .where(
      and(eq(budgetEnvelopes.id, id), eq(budgetEnvelopes.userId, session.user.id))
    );

  if (!row) return { error: "Not found" as const, status: 404 };
  return { row, userId: session.user.id };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const found = await ownedEnvelope(req, id);
  if ("error" in found) {
    return NextResponse.json({ error: found.error }, { status: found.status });
  }

  const body = await req.json().catch(() => null);
  const patch: Partial<typeof budgetEnvelopes.$inferInsert> = {};

  if (typeof body?.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (body?.monthlyTarget !== undefined) {
    const t = Number(body.monthlyTarget);
    if (!Number.isFinite(t) || t < 0) {
      return NextResponse.json(
        { error: "monthlyTarget must be a non-negative number" },
        { status: 400 }
      );
    }
    patch.monthlyTarget = t;
  }
  if (Array.isArray(body?.categoryRules)) {
    patch.categoryRules = JSON.stringify(
      body.categoryRules.filter((r: unknown): r is string => typeof r === "string")
    );
  }
  if (body?.active !== undefined) patch.active = body.active ? 1 : 0;
  if (Number.isFinite(Number(body?.sortOrder))) {
    patch.sortOrder = Number(body.sortOrder);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No supported fields to update" }, { status: 400 });
  }

  await db.update(budgetEnvelopes).set(patch).where(eq(budgetEnvelopes.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const found = await ownedEnvelope(req, id);
  if ("error" in found) {
    return NextResponse.json({ error: found.error }, { status: found.status });
  }

  await db
    .update(budgetEnvelopes)
    .set({ active: 0 })
    .where(eq(budgetEnvelopes.id, id));

  return NextResponse.json({ ok: true, deactivated: true });
}
