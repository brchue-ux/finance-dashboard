/**
 * Pure CSV amount-sign analysis. Deliberately free of React Native imports so
 * it can be exercised directly — the logic decides whether an import inverts
 * every transaction, which is too consequential to leave untestable behind a
 * hook that only loads inside the app.
 */

/** Split one CSV line, honouring double-quoted fields (banks quote descriptions). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim().replace(/^"|"$/g, ""));
}

export interface AmountSignProfile {
  positive: number;
  negative: number;
  parsed: number;
  /** Every amount shares one sign, so the file alone can't say which way it means. */
  uniform: boolean;
}

/**
 * Counts the signs in the chosen amount column.
 *
 * Why this exists: a CSV where every amount is positive is ambiguous — it is
 * either all deposits, or (far more commonly) a spending export stating debits
 * as positive numbers. Guessing wrong silently inverts the entire import. A
 * real one recorded 50 purchases as income, inflating one month's income by
 * ~$2.9k and under-reporting expenses by the same amount, behind a success
 * message with no warning anywhere. Callers use `uniform` to force an explicit
 * answer rather than defaulting to an interpretation.
 */
export function amountSignProfile(csv: string, amountHeader: string): AmountSignProfile {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headers = splitCsvLine(lines[0] ?? "");
  const idx = headers.findIndex((h) => h === amountHeader);
  let positive = 0;
  let negative = 0;
  let parsed = 0;

  if (idx >= 0) {
    for (const line of lines.slice(1)) {
      const cell = splitCsvLine(line)[idx];
      if (cell == null) continue;
      // Tolerate currency symbols, thousands separators and (123.45) negatives.
      const paren = /^\(.*\)$/.test(cell.trim());
      const n = Number(cell.replace(/[()$,\s]/g, ""));
      if (!Number.isFinite(n) || n === 0) continue;
      parsed++;
      if (paren || n < 0) negative++;
      else positive++;
    }
  }

  return {
    positive,
    negative,
    parsed,
    uniform: parsed > 0 && (positive === 0 || negative === 0),
  };
}
