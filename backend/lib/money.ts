/**
 * The backend money seam — the ONE place dollars become storage and back.
 *
 * Ledger money is stored as **integer cents** (`db/schema.ts`, the five money
 * columns). Floating-point dollars drift, and the app's headline invariant —
 * `totalIncome − totalOutflow` equalling actual account movement — is exactly
 * the kind of running sum that drift breaks once a database holds thousands of
 * rows.
 *
 * Callers above the database still speak **dollars**. The conversion happens at
 * the driver boundary via the `moneyCents` column type below, so a `select`
 * hands back dollars and an `insert`/`update` takes dollars, exactly as before
 * the migration. That is deliberate: this is part 1 of 2. Part 2 pushes cents
 * outward through calculation and display; until then, nothing above `db/`
 * changes.
 *
 * Sibling of `frontend/lib/money.ts`, which owns *formatting* for the same
 * reason this file owns *conversion*: one file to change, not every screen.
 *
 * ## The rounding rule (single, documented, applied everywhere)
 *
 * **Half away from zero**, evaluated on the decimal representation.
 *
 * - `$1.005 → 101¢` and `-$1.005 → -101¢` — symmetric, so negating an amount
 *   negates its cents. The ledger's sign convention (negative = debit/spend)
 *   therefore survives conversion untouched.
 * - "Evaluated on the decimal representation" is not pedantry. The obvious
 *   `Math.round(1.005 * 100)` yields **100**, not 101, because the double
 *   nearest to `1.005` is slightly *below* it and multiplying by 100 keeps it
 *   below the half-cent boundary. `shiftDecimal` moves the decimal point in the
 *   number's own base-10 string instead, so the boundary case rounds the way a
 *   human reading "$1.005" expects.
 *
 * Do not add `Math.round` at a call site. If a value needs to become cents, it
 * goes through `toCents`.
 *
 * ## Minor unit: two decimals, module-wide
 *
 * `CENTS_PER_DOLLAR` is a module constant, so the seam assumes every amount it
 * sees uses a **two-decimal minor unit**. That holds for CAD, USD and EUR — the
 * target regions — and the schema's `iso_currency_code` columns are therefore
 * not consulted here. A zero-decimal currency (JPY) or a three-decimal one
 * (KWD, BHD) would break that assumption: supporting one means selecting the
 * scale per `iso_currency_code` at the point of conversion rather than reading
 * it off a constant. Nothing here does that today, on purpose.
 */
import { customType } from "drizzle-orm/sqlite-core";

/** Minor units per major unit. Currency-neutral by name; 100 for CAD/USD/EUR. */
export const CENTS_PER_DOLLAR = 100;

/**
 * Multiply by a power of ten by shifting the decimal point in `value`'s own
 * base-10 string, not by float multiplication. See the rounding-rule note above
 * for why this matters at the half-cent boundary.
 */
function shiftDecimal(value: number, places: number): number {
  const [mantissa, exponent] = value.toString().split("e");
  const shifted = exponent === undefined ? places : Number(exponent) + places;
  return Number(`${mantissa}e${shifted}`);
}

/** Half away from zero, so positive and negative amounts round symmetrically. */
function roundHalfAwayFromZero(value: number): number {
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  // `-Math.round(0.4)` is -0, which reads back as 0 everywhere but compares
  // surprisingly (`Object.is(-0, 0)` is false). Normalize it away.
  return rounded === 0 ? 0 : rounded;
}

/**
 * Dollars → integer cents, using the module's rounding rule.
 *
 * Throws rather than coercing: a non-finite amount reaching storage is a bug
 * upstream (a division by zero, a `parseFloat` of a bad import cell), and a
 * silent `NULL` or `NaN` in the ledger is precisely the class of defect this
 * migration exists to remove.
 */
export function toCents(dollars: number): number {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) {
    throw new TypeError(`toCents: expected a finite number, got ${String(dollars)}`);
  }
  const cents = roundHalfAwayFromZero(shiftDecimal(dollars, 2));
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`toCents: ${dollars} is outside the exactly representable range`);
  }
  return cents;
}

/**
 * Integer cents → dollars.
 *
 * Strict about receiving an integer on purpose. A fractional value here means
 * the column it came from still holds pre-migration dollars, and reading $12.34
 * as $0.1234 across a whole screen is far worse than a loud failure that names
 * the cause. See `db/migrate-money-to-cents.ts`.
 */
export function fromCents(cents: number): number {
  if (typeof cents !== "number" || !Number.isFinite(cents)) {
    throw new TypeError(`fromCents: expected a finite number, got ${String(cents)}`);
  }
  if (!Number.isInteger(cents)) {
    throw new TypeError(
      `fromCents: expected integer cents, got ${cents} — this column looks un-migrated (see db/migrate-money-to-cents.ts)`
    );
  }
  return cents / CENTS_PER_DOLLAR;
}

/**
 * Is this amount already an exact whole number of cents?
 *
 * Storage quantizes every money value independently, so a set of amounts that
 * must stay in agreement (splits summing to their parent, a reallocation moving
 * exactly what it takes) has to be whole cents *before* it is written — half a
 * cent per row survives validation and then rounds each row its own way.
 * Validators use this to refuse such input rather than to quantize it silently.
 *
 * Defined in terms of `toCents` so there is still exactly one rounding rule.
 */
export function isWholeCents(dollars: number): boolean {
  return fromCents(toCents(dollars)) === dollars;
}

/** `toCents` for nullable money columns; null and undefined pass through as null. */
export function toCentsOrNull(dollars: number | null | undefined): number | null {
  return dollars == null ? null : toCents(dollars);
}

/** `fromCents` for nullable money columns; null and undefined pass through as null. */
export function fromCentsOrNull(cents: number | null | undefined): number | null {
  return cents == null ? null : fromCents(cents);
}

/**
 * The drizzle column type for ledger money: **integer cents in the database,
 * dollars in TypeScript**.
 *
 * Every drizzle read and write path is covered by this — `select`, `insert`,
 * `update`, `returning`, and the bound parameters of comparison operators
 * (`eq`/`gt`/`lt`/`inArray` encode their operand through the column's mapper).
 * Null and undefined bypass both mappers, so nullable columns keep working.
 *
 * The one thing it cannot cover is a hand-written `sql` fragment that names a
 * money column: raw SQL yields raw cents. There are none today (all summing
 * happens in TypeScript) — if you add one, convert its result with `fromCents`.
 */
export const moneyCents = customType<{ data: number; driverData: number }>({
  dataType: () => "integer",
  toDriver: toCents,
  fromDriver: fromCents,
});
