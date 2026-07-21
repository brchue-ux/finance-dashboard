/**
 * Envelope reallocation — moving budgeted dollars between envelopes for one
 * month, without changing the total budgeted.
 *
 * This is the write path behind an LLM action card's "Approve". The card names
 * its envelopes as free text (`envelope_from` / `envelope_to`), so the names
 * are model output, not identifiers: they can be misspelled, renamed since the
 * card was generated, or entirely hallucinated. Everything here treats them as
 * untrusted and resolves against the user's real envelopes before any write.
 *
 * The conservation rule is that a reallocation moves money — it never creates
 * or destroys it. `from` loses exactly what `to` gains, which is why both
 * upserts have to land in one transaction.
 */

export interface EnvelopeRow {
  id: string;
  name: string;
  monthlyTarget: number;
}

export interface AllocationRow {
  envelopeId: string;
  allocated: number;
}

export interface ReallocationPlan {
  from: { envelopeId: string; name: string; before: number; after: number };
  to: { envelopeId: string; name: string; before: number; after: number };
  amount: number;
}

export type ReallocationResult =
  | { ok: true; plan: ReallocationPlan }
  | { ok: false; error: string };

/**
 * A month's budgeted figure for an envelope is its standing `monthlyTarget`
 * unless an allocation row overrides it for that specific month. Callers must
 * use this rather than reading either source alone, or a reallocation applied
 * twice would compound off the wrong base.
 */
export function currentAllocation(
  envelope: EnvelopeRow,
  allocations: AllocationRow[]
): number {
  const override = allocations.find((a) => a.envelopeId === envelope.id);
  return override ? override.allocated : envelope.monthlyTarget;
}

/** Case- and whitespace-insensitive, because the name came from an LLM. */
function findByName(envelopes: EnvelopeRow[], name: string): EnvelopeRow | undefined {
  const key = name.trim().toLowerCase();
  return envelopes.find((e) => e.name.trim().toLowerCase() === key);
}

export function planReallocation(params: {
  envelopes: EnvelopeRow[];
  allocations: AllocationRow[];
  fromName: unknown;
  toName: unknown;
  amount: unknown;
}): ReallocationResult {
  const fromName = typeof params.fromName === "string" ? params.fromName.trim() : "";
  const toName = typeof params.toName === "string" ? params.toName.trim() : "";
  const amount = Number(params.amount);

  if (!fromName || !toName) {
    return { ok: false, error: "envelope_from and envelope_to are required" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "amount must be a positive number" };
  }

  const from = findByName(params.envelopes, fromName);
  const to = findByName(params.envelopes, toName);

  // Naming a nonexistent envelope is the expected failure mode for a
  // hallucinated or stale card, so it gets a message the UI can show as-is.
  if (!from) return { ok: false, error: `No envelope named "${fromName}"` };
  if (!to) return { ok: false, error: `No envelope named "${toName}"` };
  if (from.id === to.id) {
    return { ok: false, error: "Cannot reallocate an envelope into itself" };
  }

  const fromBefore = currentAllocation(from, params.allocations);
  const toBefore = currentAllocation(to, params.allocations);
  const fromAfter = fromBefore - amount;

  // A negative budget isn't a budget. Refusing beats clamping, which would
  // quietly move less than the approved amount and break conservation.
  if (fromAfter < 0) {
    return {
      ok: false,
      error: `"${from.name}" has only $${fromBefore.toFixed(2)} budgeted this month — can't move $${amount.toFixed(2)} out of it`,
    };
  }

  return {
    ok: true,
    plan: {
      from: { envelopeId: from.id, name: from.name, before: fromBefore, after: fromAfter },
      to: { envelopeId: to.id, name: to.name, before: toBefore, after: toBefore + amount },
      amount,
    },
  };
}
