/**
 * Card-JSON extraction, shared by the nightly Batch path and the synchronous
 * generateCards() fallback so the two can't drift.
 *
 * `AUTO_CARD_INSTRUCTION` already tells the model "no markdown fences", and the
 * model fences anyway — that instruction alone accounted for 2 of the 4 real
 * nightly batch items that were recorded as failures. Parsing tolerates the
 * fence rather than trusting the prompt.
 */

/** First fenced block if the response is fenced; the whole text otherwise. */
const FENCED_BLOCK = /```(?:json)?\s*\n?([\s\S]*?)```/;

export function stripCodeFence(text: string): string {
  const fenced = text.match(FENCED_BLOCK);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Returns the card array, or throws with a reason suitable for storing in
 * job_runs. Validates that `cards` is actually an array: a well-formed JSON
 * object without the key used to yield `undefined`, which then reached
 * JSON.stringify() and was written to a NOT NULL column as the string
 * "undefined".
 */
export function parseCards(text: string): unknown[] {
  const body = stripCodeFence(text);
  if (!body) throw new Error("model returned no text");

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new Error(`invalid card JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const cards = (parsed as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(cards)) {
    throw new Error(`card JSON has no "cards" array (got ${describe(parsed)})`);
  }
  return cards;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return `object with keys [${Object.keys(value as object).join(", ")}]`;
  return typeof value;
}
