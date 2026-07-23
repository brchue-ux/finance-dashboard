/**
 * The one money formatter (region/currency door-open constraint, 2026-07-22):
 * currency display lives HERE so a future USD/EUR expansion changes one file,
 * not every screen. Five screens had drifted their own near-identical copies —
 * differing on digits, abs, and where the minus sign went.
 *
 * Shape: "-$1,234" (sign before the symbol — "$-1,234" reads like a typo).
 */
export function formatMoney(n: number, opts?: { digits?: number; abs?: boolean }): string {
  const digits = opts?.digits ?? 0;
  const v = opts?.abs ? Math.abs(n) : n;
  const magnitude = Math.abs(v).toLocaleString("en-CA", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${v < 0 ? "-" : ""}$${magnitude}`;
}
