// Shared Holding Detail chart controller (spec §9). ONE implementation drives
// both render paths: on native it is inlined (as text) into the WebView asset by
// scripts/build-chart-asset.mjs; on web it is imported directly by
// ChartView.web.tsx and given the lightweight-charts module. It never imports
// lightweight-charts itself — the caller passes the `LC` namespace — so the
// native bundle stays free of the library and the web bundle gets the real one.
//
// Plain JS on purpose: the same source has to be embeddable as a <script> body
// AND importable as a module. Kept framework-free; the host calls the returned
// methods (no postMessage coupling here — that bridge lives in the asset).

/**
 * @typedef {{ time: string, open: number, high: number, low: number, close: number }} Bar
 * @typedef {{ costBasis?: number, purchaseTime?: string, purchaseLabel?: string }} Overlay
 * @typedef {{ text?: string, accent?: string }} Theme
 * @typedef {{ ma20?: boolean, ma50?: boolean, rsi?: boolean, macd?: boolean }} IndicatorFlags
 */

function sma(bars, period) {
  var out = [], sum = 0;
  for (var i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= period) sum -= bars[i - period].close;
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
  }
  return out;
}

// Wilder's RSI (14): seed with a simple average of the first `period` changes,
// then smooth. Emits one point per bar from index `period` onward.
function rsiSeries(bars, period) {
  var out = [];
  if (bars.length <= period) return out;
  var gain = 0, loss = 0;
  for (var i = 1; i <= period; i++) {
    var ch = bars[i].close - bars[i - 1].close;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  var avgGain = gain / period, avgLoss = loss / period;
  function val(ag, al) { return al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  out.push({ time: bars[period].time, value: val(avgGain, avgLoss) });
  for (var j = period + 1; j < bars.length; j++) {
    var c = bars[j].close - bars[j - 1].close;
    var g = c >= 0 ? c : 0, l = c < 0 ? -c : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out.push({ time: bars[j].time, value: val(avgGain, avgLoss) });
  }
  return out;
}

function ema(values, period) {
  var k = 2 / (period + 1), out = [], prev = 0;
  for (var i = 0; i < values.length; i++) {
    prev = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// MACD(12,26,9): line = EMA12 − EMA26, signal = EMA9(line), histogram = line − signal.
function macdSeries(bars) {
  var closes = bars.map(function (b) { return b.close; });
  var e12 = ema(closes, 12), e26 = ema(closes, 26);
  var line = closes.map(function (_, i) { return e12[i] - e26[i]; });
  var signal = ema(line, 9);
  var macd = [], sig = [], hist = [];
  for (var i = 0; i < bars.length; i++) {
    macd.push({ time: bars[i].time, value: line[i] });
    sig.push({ time: bars[i].time, value: signal[i] });
    var h = line[i] - signal[i];
    hist.push({ time: bars[i].time, value: h, color: h >= 0 ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)" });
  }
  return { macd: macd, signal: sig, hist: hist };
}

/**
 * @param {any} LC  lightweight-charts namespace (global on native, import on web)
 * @param {HTMLElement} el  container element
 */
export function createHoldingChartController(LC, el) {
  var chart = null;
  /** @type {{ bars: Bar[], overlay: Overlay|null, theme: Theme|null, flags: IndicatorFlags }} */
  var state = { bars: [], overlay: null, theme: null, flags: {} };

  // Full rebuild on every change. Toggling an indicator adds/removes a sub-pane,
  // and rebuilding is the deterministic way to keep pane indices and heights
  // correct without leaking empty panes; toggles are rare user taps, so the cost
  // (losing zoom/scroll state) is acceptable and the code stays simple.
  function render() {
    if (chart) { chart.remove(); chart = null; }
    var bars = state.bars;
    if (!bars.length) return;
    var theme = state.theme || {};
    var text = theme.text || "#F8FAFC";
    var accent = theme.accent || "#7C3AED";

    chart = LC.createChart(el, {
      layout: { background: { color: "transparent" }, textColor: text, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.06)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: LC.CrosshairMode.Normal },
      autoSize: true,
    });

    var candles = chart.addSeries(LC.CandlestickSeries, {
      upColor: "#22C55E", downColor: "#EF4444",
      wickUpColor: "#22C55E", wickDownColor: "#EF4444",
      borderVisible: false,
    });
    candles.setData(bars);

    var overlay = state.overlay;
    if (overlay && typeof overlay.costBasis === "number") {
      candles.createPriceLine({
        price: overlay.costBasis, color: accent, lineWidth: 1,
        lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: "Cost",
      });
    }
    if (overlay && overlay.purchaseTime && LC.createSeriesMarkers) {
      LC.createSeriesMarkers(candles, [{
        time: overlay.purchaseTime, position: "belowBar", color: accent,
        shape: "arrowUp", text: overlay.purchaseLabel || "Buy",
      }]);
    }

    var flags = state.flags;
    if (flags.ma20) {
      chart.addSeries(LC.LineSeries, { color: "#60A5FA", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0)
        .setData(sma(bars, 20));
    }
    if (flags.ma50) {
      chart.addSeries(LC.LineSeries, { color: "#F59E0B", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 0)
        .setData(sma(bars, 50));
    }

    // RSI and MACD each get their own stacked sub-pane below price.
    var pane = 1;
    if (flags.rsi) {
      var rsi = chart.addSeries(LC.LineSeries, {
        color: "#A78BFA", lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        // Pin the RSI pane to 0..100 so the 30/70 guide lines always sit correctly.
        autoscaleInfoProvider: function () { return { priceRange: { minValue: 0, maxValue: 100 } }; },
      }, pane);
      rsi.setData(rsiSeries(bars, 14));
      rsi.createPriceLine({ price: 70, color: "rgba(239,68,68,0.4)", lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: "70" });
      rsi.createPriceLine({ price: 30, color: "rgba(34,197,94,0.4)", lineWidth: 1, lineStyle: LC.LineStyle.Dashed, axisLabelVisible: true, title: "30" });
      pane++;
    }
    if (flags.macd) {
      var m = macdSeries(bars);
      chart.addSeries(LC.HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane).setData(m.hist);
      chart.addSeries(LC.LineSeries, { color: "#60A5FA", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane).setData(m.macd);
      chart.addSeries(LC.LineSeries, { color: "#F59E0B", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, pane).setData(m.signal);
      pane++;
    }

    // Give price the lion's share of height; each indicator pane a slim strip.
    var panes = chart.panes();
    if (panes.length > 1) {
      panes[0].setStretchFactor(3);
      for (var p = 1; p < panes.length; p++) panes[p].setStretchFactor(1);
    }

    chart.timeScale().fitContent();
  }

  return {
    /** @param {Bar[]} bars @param {Overlay|null} [overlay] @param {Theme|null} [theme] */
    setData: function (bars, overlay, theme) {
      state.bars = bars || [];
      state.overlay = overlay || null;
      state.theme = theme || null;
      render();
    },
    /** @param {IndicatorFlags} flags */
    setIndicators: function (flags) {
      state.flags = {
        ma20: !!(flags && flags.ma20), ma50: !!(flags && flags.ma50),
        rsi: !!(flags && flags.rsi), macd: !!(flags && flags.macd),
      };
      render();
    },
    remove: function () { if (chart) { chart.remove(); chart = null; } },
  };
}
