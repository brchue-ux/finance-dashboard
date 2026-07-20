/**
 * POST /api/budget/envelopes/defaults — create any missing default envelopes.
 *
 * lib/categorization.ts ships DEFAULT_RULES ("These seed the
 * budget_envelopes.category_rules column") but nothing ever consumed it, so the
 * table stayed empty and categorize() had nothing to match against. This is the
 * consumer.
 *
 * Targets are created at 0: the merchant rules are a sensible shared default,
 * but what someone intends to spend per month is theirs to set. A 0-target
 * envelope still categorizes correctly — it just reports as over budget until a
 * real target is entered.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { budgetEnvelopes } from "@/db/schema";
import { DEFAULT_RULES } from "@/lib/categorization";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  const existing = await db
    .select({ name: budgetEnvelopes.name })
    .from(budgetEnvelopes)
    .where(eq(budgetEnvelopes.userId, userId));
  const taken = new Set(existing.map((e) => e.name.toLowerCase()));

  const now = Date.now();
  const toCreate = Object.entries(DEFAULT_RULES)
    .filter(([name]) => !taken.has(name.toLowerCase()))
    .map(([name, rules], i) => ({
      id: randomUUID(),
      userId,
      name,
      monthlyTarget: 0,
      categoryRules: JSON.stringify(rules),
      active: 1,
      sortOrder: existing.length + i,
      createdAt: now,
    }));

  if (toCreate.length > 0) {
    await db.insert(budgetEnvelopes).values(toCreate);
  }

  return NextResponse.json({
    created: toCreate.map((e) => e.name),
    skipped: Object.keys(DEFAULT_RULES).filter((n) => taken.has(n.toLowerCase())),
  });
}
