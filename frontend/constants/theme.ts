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
