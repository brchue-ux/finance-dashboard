import { describe, expect, it } from "vitest";
import { duplicateFilter } from "./pipeline";

// Fingerprints taken from the real Tangerine export, where this bug destroyed
// 74 rows worth $7,294 on a single import.
const WS50 = "2025-08-08|EFT Withdrawal to WS Investments|-50.00";
const WS200 = "2025-05-20|EFT Withdrawal to WS Investments|-200.00";
const PAY = "2025-08-15|EFT Deposit from STERICYCLE ULC|2400.00";

describe("duplicateFilter", () => {
  it("treats everything as new when the database is empty", () => {
    const isDup = duplicateFilter([]);
    expect(isDup(WS50)).toBe(false);
    expect(isDup(WS50)).toBe(false);
    expect(isDup(WS50)).toBe(false);
  });

  // The actual bug: three identical transfers really happened on one day, and
  // presence-only dedup kept exactly one of them.
  it("keeps genuinely repeated transactions that are byte-identical", () => {
    const isDup = duplicateFilter([WS50]);
    expect(isDup(WS50)).toBe(true); // covered by the stored row
    expect(isDup(WS50)).toBe(false); // a second real occurrence
    expect(isDup(WS50)).toBe(false); // and a third
  });

  it("stays idempotent when the same file is imported twice", () => {
    const isDup = duplicateFilter([WS50, WS50, WS50]);
    expect([isDup(WS50), isDup(WS50), isDup(WS50)]).toEqual([true, true, true]);
  });

  it("counts each distinct transaction separately", () => {
    const isDup = duplicateFilter([WS50, WS200]);
    expect(isDup(WS50)).toBe(true);
    expect(isDup(WS200)).toBe(true);
    expect(isDup(WS50)).toBe(false);
    expect(isDup(PAY)).toBe(false);
  });
});
