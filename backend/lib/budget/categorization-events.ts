/**
 * Recording a labeled example whenever a human decides a category.
 *
 * Two things call this — a manual correction (6a) and a learned-rule save (6b) —
 * and nothing else: the engine's own guesses at import time are not labels, only
 * the moments a person tells us the answer. Kept as one helper so every write
 * captures the same fields the same way, because a training set is only as good
 * as its most inconsistent row.
 *
 * The merchant handle is derived here, from the same normalization the matcher
 * uses, so the stored handle always matches what categorize() would key on.
 */
import { db } from "@/db";
import { categorizationEvents } from "@/db/schema";
import { normalizeDescription } from "@/lib/categorization";
import { v4 as uuidv4 } from "uuid";

export type CategorizationEventType = "manual_correction" | "rule_saved";

export async function recordCategorizationEvent(e: {
  userId: string;
  eventType: CategorizationEventType;
  transactionId?: string | null;
  rawDescription: string;
  category: string;
  previousCategory?: string | null;
  pattern?: string | null;
}): Promise<void> {
  await db.insert(categorizationEvents).values({
    id: uuidv4(),
    userId: e.userId,
    eventType: e.eventType,
    transactionId: e.transactionId ?? null,
    rawDescription: e.rawDescription,
    merchantHandle: normalizeDescription(e.rawDescription),
    category: e.category,
    previousCategory: e.previousCategory ?? null,
    pattern: e.pattern ?? null,
    createdAt: Math.floor(Date.now() / 1000),
  });
}
