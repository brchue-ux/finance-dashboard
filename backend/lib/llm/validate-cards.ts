/**
 * Deterministic numeric validation of LLM insight/action cards — item 4.
 *
 * The model asserts arithmetic in prose, and sometimes wrongly: a real card
 * claimed "$376 ... 50% over your $750 target" when $376 is 50% OF $750. The
 * numbers were real; the relation was false. Cards state money facts the user
 * will act on, so math checks the model — never the reverse.
 *
 * Two checks, both pure:
 *
 *   GROUNDING — every dollar figure a card cites must be derivable from the
 *   data context the model was shown: equal to a context value, a sum or
 *   difference of two, or a 12× annualization / monthly-ization of one
 *   (within a rounding tolerance — cards legitimately say "$1,660" for
 *   1659.73). A dollar amount with no derivation is a hallucinated number.
 *
 *   RELATIONS — "X% of/over/under Y" must actually hold among the numbers
 *   involved. "of" means a/b, "over" means a exceeds b by the stated share,
 *   "under" the reverse. A bare percent (no relation word) passes if ANY of
 *   those forms fits some pair — lenient, because its meaning is ambiguous.
 *
 * Failing cards are DROPPED, not repaired: a card whose math cannot be
 * verified is worth less than no card. Callers log what fell.
 */

export interface CardLike {
  title?: unknown;
  body?: unknown;
  reasoning?: unknown;
  [key: string]: unknown;
}

export interface ValidationResult<T extends CardLike> {
  cards: T[];
  dropped: { title: string; reasons: string[] }[];
}

/** $1,234.56 / $1.6k → 1234.56 / 1600. Only $-prefixed tokens are money —
 *  bare counts ("9 days", "15+ orders") are not our jurisdiction. */
export function extractMoney(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?([\d,]+(?:\.\d+)?)\s?([kK])?/g;
  for (const m of text.matchAll(re)) {
    const v = parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    if (Number.isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

export interface PercentClaim {
  pct: number;
  relation: "of" | "over" | "under" | null;
}

/** "50% over", "15% of", "up 12%" (bare → relation null). */
export function extractPercentClaims(text: string): PercentClaim[] {
  const out: PercentClaim[] = [];
  const re = /([\d.]+)\s?%\s*(of|over|above|under|below)?\b/g;
  for (const m of text.matchAll(re)) {
    const pct = parseFloat(m[1]);
    if (!Number.isFinite(pct) || pct <= 0) continue;
    const word = m[2];
    const relation =
      word === "of" ? "of" : word === "over" || word === "above" ? "over" : word === "under" || word === "below" ? "under" : null;
    out.push({ pct, relation });
  }
  return out;
}

/** Every numeric token in the assembled data context, as the grounding base.
 *  Years (2020–2035) are excluded — a date is not a dollar amount, and "$2,026"
 *  must not ground against the year 2026. */
export function extractContextNumbers(context: string): number[] {
  const seen = new Set<number>();
  const re = /\d[\d,]*(?:\.\d+)?/g;
  for (const m of context.matchAll(re)) {
    const v = Math.abs(parseFloat(m[0].replace(/,/g, "")));
    if (!Number.isFinite(v) || v === 0 || v > 1e9) continue;
    if (Number.isInteger(v) && v >= 2020 && v <= 2035) continue;
    seen.add(v);
  }
  return [...seen];
}

/** Rounded-in-prose tolerance: $1 or 1.5%, whichever is larger. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, 0.015 * Math.max(a, b));
}

/** Is `x` derivable from the context: a value, a±b of two values, or ×/÷12? */
export function isGrounded(x: number, context: number[]): boolean {
  for (const c of context) {
    if (near(x, c) || near(x, c * 12) || near(x, c / 12)) return true;
  }
  for (let i = 0; i < context.length; i++) {
    for (let j = i + 1; j < context.length; j++) {
      const a = context[i], b = context[j];
      if (near(x, a + b) || near(x, Math.abs(a - b))) return true;
    }
  }
  return false;
}

/** |actual − claimed| tolerance on a percent: 3 points or 5% relative. */
function pctNear(actualFraction: number, claimedPct: number): boolean {
  const actual = actualFraction * 100;
  return Math.abs(actual - claimedPct) <= Math.max(3, 0.05 * claimedPct);
}

/**
 * A percent claim holds if some ordered pair (a, b) — with at least one side
 * cited by the card itself — satisfies the claimed relation.
 */
export function percentClaimHolds(
  claim: PercentClaim,
  cardMoney: number[],
  contextNumbers: number[]
): boolean {
  if (cardMoney.length === 0) return true; // no money cited — nothing to relate
  const pool = [...new Set([...cardMoney, ...contextNumbers])];

  for (const a of cardMoney) {
    for (const b of pool) {
      if (b === 0) continue;
      const forms: Record<string, boolean> = {
        of: pctNear(a / b, claim.pct),
        over: a > b && pctNear((a - b) / b, claim.pct),
        under: a < b && pctNear((b - a) / b, claim.pct),
      };
      if (claim.relation ? forms[claim.relation] : forms.of || forms.over || forms.under) {
        return true;
      }
      // The pair may be stated in either order in prose.
      if (a !== 0) {
        const swapped: Record<string, boolean> = {
          of: pctNear(b / a, claim.pct),
          over: b > a && pctNear((b - a) / a, claim.pct),
          under: b < a && pctNear((a - b) / a, claim.pct),
        };
        if (claim.relation ? swapped[claim.relation] : swapped.of || swapped.over || swapped.under) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * "$460 over", "short by $37" — a claimed DIFFERENCE. Word order is load-
 * bearing: "over-budgeted at $1,210" states a level, not a difference, so only
 * amount-then-word and "by $X" forms count.
 */
export function extractDiffClaims(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s?([kK])?\s+(?:over|under|short|left|remaining)\b/gi)) {
    out.push(parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));
  }
  for (const m of text.matchAll(/(?:over|under|short)\s+by\s+\$\s?([\d,]+(?:\.\d+)?)\s?([kK])?/gi)) {
    out.push(parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));
  }
  return out.filter((v) => Number.isFinite(v) && v > 0);
}

/**
 * A claimed difference must be the difference of two OTHER amounts the card
 * itself cites — a card that says "$460 over" while citing $670 and $1,210 is
 * incoherent no matter what the wider context holds (a real kept-card case:
 * the $460 grounded against an unrelated envelope's numbers). Cards citing
 * fewer than two other amounts can't be checked and pass.
 */
export function diffClaimHolds(claim: number, cardMoney: number[]): boolean {
  const others = [...cardMoney];
  const idx = others.findIndex((v) => near(v, claim));
  if (idx >= 0) others.splice(idx, 1);
  if (others.length < 2) return true;
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      if (near(claim, Math.abs(others[i] - others[j]))) return true;
    }
  }
  return false;
}

export function validateCards<T extends CardLike>(
  cards: T[],
  contextText: string
): ValidationResult<T> {
  const contextNumbers = extractContextNumbers(contextText);
  const kept: T[] = [];
  const dropped: { title: string; reasons: string[] }[] = [];

  for (const card of cards) {
    const text = [card.title, card.body, card.reasoning]
      .filter((s): s is string => typeof s === "string")
      .join(" ");
    const money = extractMoney(text);
    const reasons: string[] = [];

    for (const x of money) {
      if (!isGrounded(x, contextNumbers)) {
        reasons.push(`$${x} not derivable from context`);
      }
    }
    for (const claim of extractPercentClaims(text)) {
      if (!percentClaimHolds(claim, money, contextNumbers)) {
        reasons.push(`${claim.pct}%${claim.relation ? " " + claim.relation : ""} does not hold`);
      }
    }
    for (const claim of extractDiffClaims(text)) {
      if (!diffClaimHolds(claim, money)) {
        reasons.push(`$${claim} over/under is not the difference of any two cited amounts`);
      }
    }

    if (reasons.length === 0) kept.push(card);
    else dropped.push({ title: typeof card.title === "string" ? card.title : "(untitled)", reasons });
  }
  return { cards: kept, dropped };
}
