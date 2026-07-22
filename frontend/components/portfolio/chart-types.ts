/**
 * Shared prop/data types for the Holding Detail chart. Kept separate from
 * ChartView so both the native (ChartView.tsx, WebView) and web-direct
 * (ChartView.web.tsx) implementations import them from one place — importing
 * from "./ChartView" inside the .web variant would resolve back to itself under
 * Metro's platform resolution.
 */
export interface ChartBar {
  time: string | number; // YYYY-MM-DD for daily/weekly bars, unix seconds for intraday
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartOverlay {
  costBasis?: number;
  purchaseTime?: string; // YYYY-MM-DD
  purchaseLabel?: string; // "X shares @ $Y.YY"
}

export interface ChartViewProps {
  bars: ChartBar[];
  overlay?: ChartOverlay;
  ma20?: boolean;
  ma50?: boolean;
  rsi?: boolean;
  macd?: boolean;
  height?: number;
}
