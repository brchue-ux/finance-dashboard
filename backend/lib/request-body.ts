/**
 * Reading a JSON object body off a request without turning client mistakes
 * into 500s.
 *
 * An unguarded `await req.json()` throws on a malformed or empty body, which
 * Next.js reports as an unstructured 500 — a server error for what is squarely
 * a client one. The money-write routes already guarded that with
 * `.catch(() => null)`, but then fell through to a *domain* error message
 * ("envelope_from and envelope_to are required" for the body `not-json`), which
 * is a correct status with a misleading reason.
 *
 * This returns null for anything that is not a JSON object — including arrays
 * and bare primitives, which `body?.field` silently reads as `undefined` — so
 * the caller can answer "the body is wrong" before reasoning about fields.
 */

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(req: Request): Promise<JsonObject | null> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as JsonObject;
}

/**
 * A JSON number or a numeric string, and nothing else.
 *
 * `Number()` alone is too permissive on request input: `Number([])` is 0 and
 * `Number(true)` is 1, both of which pass an `Number.isInteger` check. That is
 * how `{"year": []}` reached envelope_allocations as a row for year 0.
 */
export function coerceInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  }
  return null;
}

/**
 * The largest magnitude a money field may carry, in dollars.
 *
 * `toCents` throws a RangeError once an amount leaves the exactly representable
 * cents range, and a throw inside a route handler is a 500 — a server error for
 * what is a client one. Bounding here turns it into the 400 it always was, and
 * leaves that throw in place as the last line of defence rather than the first.
 * A trillion is orders of magnitude above any real balance and orders of
 * magnitude below where `toCents` gives up.
 */
export const MAX_MONEY_DOLLARS = 1e12;

/**
 * A JSON number or numeric string within the money range, and nothing else.
 *
 * Same permissiveness problem as `coerceInteger`: `Number([])` is 0 and
 * `Number(true)` is 1, both of which pass a bare `Number.isFinite` check. Sign
 * is deliberately not judged here — the ledger's convention (negative = debit)
 * means each caller wants a different rule, so they apply their own.
 */
export function coerceMoneyAmount(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) > MAX_MONEY_DOLLARS) return null;
  return n;
}
