/**
 * Web-direct Holding Detail chart (spec §9). Metro resolves this file for the
 * web platform in place of ChartView.tsx, so on web the candlestick chart renders
 * lightweight-charts straight into a DOM node — no react-native-webview / iframe
 * bridge. It drives the SAME controller the native WebView asset uses
 * (lib/chart/holding-chart-controller.js), so there is one chart implementation
 * across platforms; only the host differs.
 */
import { useEffect, useRef } from "react";
import * as LC from "lightweight-charts";
import { COLORS } from "@/constants/theme";
import { createHoldingChartController } from "@/lib/chart/holding-chart-controller";
import type { ChartViewProps } from "./chart-types";

export type { ChartBar, ChartOverlay, ChartViewProps } from "./chart-types";

const THEME = { text: COLORS.textPrimary, accent: COLORS.brandPurple };

export function ChartView({ bars, overlay, ma20, ma50, rsi, macd, height = 260 }: ChartViewProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const ctlRef = useRef<ReturnType<typeof createHoldingChartController> | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const ctl = createHoldingChartController(LC, elRef.current);
    ctlRef.current = ctl;
    return () => {
      ctl.remove();
      ctlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (bars.length) ctlRef.current?.setData(bars, overlay, THEME);
  }, [bars, overlay]);

  useEffect(() => {
    ctlRef.current?.setIndicators({ ma20: !!ma20, ma50: !!ma50, rsi: !!rsi, macd: !!macd });
  }, [ma20, ma50, rsi, macd]);

  return (
    <div style={{ height, borderRadius: 12, overflow: "hidden" }}>
      <div ref={elRef} style={{ position: "relative", width: "100%", height: "100%" }} />
    </div>
  );
}
