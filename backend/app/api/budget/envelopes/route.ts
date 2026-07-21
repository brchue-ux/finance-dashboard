/**
 * Budget envelope management.
 *
 * GET  /api/budget/envelopes — list (including inactive, for the manage view)
 * POST /api/budget/envelopes — create one
 *
 * Envelopes are the unit the whole budget side is built on: /api/budget derives
 * every summary from them, and lib/categorization.ts matches transactions
 * against their category_rules. Until this route existed there was no write
 * path at all, so the table stayed empty and every transaction categorized as
 * "uncategorized".
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireUser } from "@/lib/auth-guard";
import { db } from "@/db";
import { budgetEnvelopes } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const rows = await db
    .select()
    .from(budgetEnvelopes)
    .where(eq(budgetEnvelopes.userId, authed.userId))
    .orderBy(asc(budgetEnvelopes.sortOrder));

  return NextResponse.json({
    envelopes: rows.map((e) => ({
      id: e.id,
      name: e.name,
      monthlyTarget: e.monthlyTarget,
      categoryRules: JSON.parse(e.categoryRules) as string[],
      active: e.active === 1,
      sortOrder: e.sortOrder,
      createdAt: e.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const authed = await requireUser(req);
  if ("response" in authed) return authed.response;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const monthlyTarget = Number(body?.monthlyTarget);
  const categoryRules = Array.isArray(body?.categoryRules)
    ? body.categoryRules.filter((r: unknown): r is string => typeof r === "string")
    : [];

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!Number.isFinite(monthlyTarget) || monthlyTarget < 0) {
    return NextResponse.json(
      { error: "monthlyTarget must be a non-negative number" },
      { status: 400 }
    );
  }

  // Envelope name doubles as the category written onto transactions, so a
  // duplicate would make spend attribution ambiguous.
  const existing = await db
    .select({ name: budgetEnvelopes.name })
    .from(budgetEnvelopes)
    .where(eq(budgetEnvelopes.userId, authed.userId));
  if (existing.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json(
      { error: `An envelope named "${name}" already exists` },
      { status: 409 }
    );
  }

  const row = {
    id: randomUUID(),
    userId: authed.userId,
    name,
    monthlyTarget,
    categoryRules: JSON.stringify(categoryRules),
    active: 1,
    sortOrder:
      Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : existing.length,
    createdAt: Date.now(),
  };

  await db.insert(budgetEnvelopes).values(row);

  return NextResponse.json(
    {
      envelope: {
        id: row.id,
        name: row.name,
        monthlyTarget: row.monthlyTarget,
        categoryRules,
        active: true,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt,
      },
    },
    { status: 201 }
  );
}
