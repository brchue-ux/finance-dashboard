/**
 * Generates lib/chart/holding-chart-html.ts — a fully self-contained HTML page
 * (Lightweight Charts v5 inlined + our chart glue) shipped as a static asset
 * for the Holding Detail chart (spec §9: bundled, not network-fetched). Loaded
 * into a react-native-webview on native and an <iframe srcDoc> on web.
 *
 * Run when the lightweight-charts version or the glue changes:
 *   node scripts/build-chart-asset.mjs
 *
 * The glue talks to the host via a tiny postMessage protocol:
 *   host → chart:  { type: "init",  bars, overlay, theme }   (also re-render on updates)
 *   host → chart:  { type: "indicators", ma20, ma50 }        (toggle MA overlays)
 *   chart → host:  { type: "ready" }                          (send state only after this)
 * The host injects messages via window.__chart(payload) (native injectedJavaScript)
 * or window.postMessage (web iframe); the chart listens for both.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const lib = readFileSync(
  resolve(here, "../../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js"),
  "utf8"
);

// Chart controller. Runs inside the WebView/iframe; `LightweightCharts` is the
// global from the inlined standalone build above.
const GLUE = `
(function () {
  var LC = window.LightweightCharts;
  var el = document.getElementById("chart");
  var chart = null, candles = null, ma20Series = null, ma50Series = null;
  var lastBars = [], lastOverlay = null, lastTheme = null;

  function post(msg) {
    var s = JSON.stringify(msg);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.parent && window.parent !== window) window.parent.postMessage(s, "*");
  }

  function sma(bars, period) {
    var out = [], sum = 0;
    for (var i = 0; i < bars.length; i++) {
      sum += bars[i].close;
      if (i >= period) sum -= bars[i - period].close;
      if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
    }
    return out;
  }

  function build(bars, overlay, theme) {
    if (chart) { chart.remove(); chart = null; }
    ma20Series = ma50Series = null;
    var text = (theme && theme.text) || "#F8FAFC";
    chart = LC.createChart(el, {
      layout: { background: { color: "transparent" }, textColor: text, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.06)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: LC.CrosshairMode.Normal },
      autoSize: true,
    });
    candles = chart.addSeries(LC.CandlestickSeries, {
      upColor: "#22C55E", downColor: "#EF4444",
      wickUpColor: "#22C55E", wickDownColor: "#EF4444",
      borderVisible: false,
    });
    candles.setData(bars);

    if (overlay && typeof overlay.costBasis === "number") {
      candles.createPriceLine({
        price: overlay.costBasis,
        color: (theme && theme.accent) || "#7C3AED",
        lineWidth: 1, lineStyle: LC.LineStyle.Dashed,
        axisLabelVisible: true, title: "Cost",
      });
    }
    if (overlay && overlay.purchaseTime && LC.createSeriesMarkers) {
      LC.createSeriesMarkers(candles, [{
        time: overlay.purchaseTime, position: "belowBar",
        color: (theme && theme.accent) || "#7C3AED", shape: "arrowUp",
        text: overlay.purchaseLabel || "Buy",
      }]);
    }
    chart.timeScale().fitContent();
  }

  function setIndicators(ma20, ma50) {
    if (!chart) return;
    if (ma20Series) { chart.removeSeries(ma20Series); ma20Series = null; }
    if (ma50Series) { chart.removeSeries(ma50Series); ma50Series = null; }
    if (ma20 && lastBars.length) {
      ma20Series = chart.addSeries(LC.LineSeries, { color: "#60A5FA", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      ma20Series.setData(sma(lastBars, 20));
    }
    if (ma50 && lastBars.length) {
      ma50Series = chart.addSeries(LC.LineSeries, { color: "#F59E0B", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      ma50Series.setData(sma(lastBars, 50));
    }
  }

  function handle(payload) {
    try {
      var msg = typeof payload === "string" ? JSON.parse(payload) : payload;
      if (!msg || !msg.type) return;
      if (msg.type === "init") {
        lastBars = msg.bars || []; lastOverlay = msg.overlay || null; lastTheme = msg.theme || null;
        if (lastBars.length) build(lastBars, lastOverlay, lastTheme);
      } else if (msg.type === "indicators") {
        setIndicators(!!msg.ma20, !!msg.ma50);
      }
    } catch (e) { post({ type: "error", message: String(e && e.message || e) }); }
  }

  // Native injects via window.__chart(...); web iframe posts a message event.
  window.__chart = handle;
  window.addEventListener("message", function (e) { handle(e.data); });
  document.addEventListener("message", function (e) { handle(e.data); });

  post({ type: "ready" });
})();
`;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: transparent; overflow: hidden; }
  #chart { position: absolute; inset: 0; }
</style>
</head>
<body>
<div id="chart"></div>
<script>${lib}</script>
<script>${GLUE}</script>
</body>
</html>`;

const outDir = resolve(here, "../lib/chart");
mkdirSync(outDir, { recursive: true });
const out = `// GENERATED by scripts/build-chart-asset.mjs — do not edit by hand.
// Self-contained Lightweight Charts v5 page for the Holding Detail chart.
export const HOLDING_CHART_HTML = ${JSON.stringify(html)};
`;
writeFileSync(resolve(outDir, "holding-chart-html.ts"), out);
console.log(`wrote lib/chart/holding-chart-html.ts (${(out.length / 1024).toFixed(0)} KB)`);
