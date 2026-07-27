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
