/**
 * Candlestick chart for Holding Detail (spec §9). Renders the bundled, static
 * Lightweight Charts page (lib/chart/holding-chart-html.ts) inside a
 * react-native-webview and feeds it OHLCV + overlays over a tiny postMessage
 * protocol. One code path across native and web (the webview renders an iframe
 * on web) — the on-device/on-web chart render is verified in the batched device
 * handoff, since a chart can't be exercised by tsc/Metro bundling alone.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { COLORS } from "@/constants/theme";
import { HOLDING_CHART_HTML } from "@/lib/chart/holding-chart-html";

export interface ChartBar {
  time: string; // YYYY-MM-DD
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
  height?: number;
}

const THEME = { text: COLORS.textPrimary, accent: COLORS.brandPurple };

export function ChartView({ bars, overlay, ma20, ma50, height = 260 }: ChartViewProps) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);

  const send = useCallback((msg: object) => {
    ref.current?.injectJavaScript(`window.__chart(${JSON.stringify(msg)}); true;`);
  }, []);

  // (Re)send data once the page signals ready, and whenever the inputs change.
  useEffect(() => {
    if (ready && bars.length) send({ type: "init", bars, overlay, theme: THEME });
  }, [ready, bars, overlay, send]);

  useEffect(() => {
    if (ready) send({ type: "indicators", ma20: !!ma20, ma50: !!ma50 });
  }, [ready, ma20, ma50, send]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg?.type === "ready") setReady(true);
    } catch {
      // non-JSON message — ignore
    }
  }, []);

  return (
    <View style={{ height, borderRadius: 12, overflow: "hidden" }}>
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        source={{ html: HOLDING_CHART_HTML }}
        onMessage={onMessage}
        scrollEnabled={false}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        style={{ backgroundColor: "transparent" }}
      />
    </View>
  );
}
