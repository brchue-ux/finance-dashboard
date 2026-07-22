export const COLORS = {
  background: "#13111C",
  brandPurple: "#7C3AED",
  brandBlue: "#2563EB",
  glassBg: "rgba(255,255,255,0.05)",
  glassBorder: "rgba(255,255,255,0.08)",
  textPrimary: "#F8FAFC",
  textMuted: "rgba(248,250,252,0.35)",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  // Feed palette — color implies, it doesn't shout. Spending is the default
  // state of a transaction list, so outflows wear the quiet secondary text
  // color and only money-in gets a hue: a mint softer than `success`, which
  // reads as an alarm-green at list density.
  textSecondary: "rgba(248,250,252,0.72)",
  moneyIn: "#34D399",
  // Insight card: yellow tint
  insightBg: "rgba(245,158,11,0.08)",
  insightBorder: "rgba(245,158,11,0.2)",
  // Action card: blue tint
  actionBg: "rgba(37,99,235,0.08)",
  actionBorder: "rgba(37,99,235,0.2)",
} as const;

export const GRADIENT = {
  brand: ["#7C3AED", "#2563EB"] as const,
  danger: ["#EF4444", "#DC2626"] as const,
};

/**
 * Muted category accents — a small dot of identity per category, desaturated
 * so a dense list gains rhythm without becoming a rainbow. Assignment is a
 * stable hash of the name: the same category is always the same color, with
 * no registry to maintain as the user renames or adds envelopes.
 */
export const CATEGORY_PALETTE = [
  "#8B7CF6", // soft violet
  "#5EA8D9", // dusty blue
  "#5BBFA8", // sea green
  "#C9A86A", // sand
  "#C77DA6", // rose
  "#7FA86B", // sage
  "#B0885E", // clay
  "#7A93C4", // slate blue
] as const;

export function categoryColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}
