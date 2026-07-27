/**
 * One place that turns a connection's raw DB status enum into something a
 * person can read.
 *
 * It exists because the mapping was only on the Banks tab: System status fell
 * through to the raw value and rendered the literal `relink_required` at the
 * user. Every surface that shows a connection status reads this table, so a
 * new status can never reach the UI as a DB enum from one screen and a friendly
 * label from another.
 *
 * Deliberately RN-free apart from the palette import, so it stays testable.
 */
import { COLORS } from "@/constants/theme";

interface StatusPresentation {
  /** Prose label, for surfaces with room (System status). */
  label: string;
  /** Spec §9 pill: same meaning, glyph-prefixed and short enough for a card. */
  pill: string;
  color: string;
}

const STATUS: Record<string, StatusPresentation> = {
  active: { label: "Live", pill: "● Live", color: COLORS.moneyIn },
  relink_required: { label: "Relink needed", pill: "⚠ Relink", color: COLORS.warning },
  reconnect_required: { label: "Relink needed", pill: "⚠ Relink", color: COLORS.warning },
  manual: { label: "Manual", pill: "Manual", color: COLORS.textMuted },
};

/** `some_new_status` → `Some new status`, so an unmapped enum still reads as words. */
function humanize(status: string): string {
  const words = status.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Friendly text for any connection status. Never returns a raw enum. */
export function connectionStatusLabel(status: string): string {
  return STATUS[status]?.label ?? humanize(status);
}

/**
 * Banks-tab status pill (spec §9: "● Live" / "⚠ Relink"), or null for a status
 * with no pill — an unrecognised one shows nothing rather than a guess.
 */
export function connectionStatusPill(status: string): { label: string; color: string } | null {
  const known = STATUS[status];
  return known ? { label: known.pill, color: known.color } : null;
}
