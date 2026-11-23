/**
 * Repeatable Browser Verification Script
 * Paste this into the TradingView Console (in MAIN world / DevTools console)
 * to verify the active chart and test position source extraction on live drawings.
 */
(() => {
  console.log("%c[Backtest Assistant] Running Verification Procedure...", "color: #1e88e5; font-weight: bold; font-size: 14px;");

  const api = window.TradingViewApi;
  if (!api || typeof api.activeChart !== "function") {
    console.error("❌ Verification Failed: window.TradingViewApi or activeChart() not available.");
    return;
  }

  const chart = api.activeChart();
  if (!chart) {
    console.error("❌ Verification Failed: activeChart() returned null/undefined.");
    return;
  }

  console.log("✔ Active chart resolved successfully.");

  const shapes = chart.getAllShapes ? chart.getAllShapes() : [];
  console.log(`✔ Found ${shapes.length} total shapes on the chart.`);

  const positionShapes = shapes.filter((s) => ["long_position", "short_position"].includes(s.name));
  console.log(`✔ Found ${positionShapes.length} position shapes (long/short).`);

  if (positionShapes.length === 0) {
    console.warn("⚠ No long_position or short_position shapes currently on the chart. Draw at least one position to verify extraction.");
    return;
  }

  // Verification table of shapes and extracted properties
  const results = [];

  for (const shape of positionShapes) {
    let source = null;
    let strategyUsed = "none";

    // 1. getShapeById
    if (typeof chart.getShapeById === "function") {
      try {
        const ent = chart.getShapeById(shape.id);
        if (ent && (ent._properties || ent._source?._properties)) {
          source = ent._source || ent;
          strategyUsed = "getShapeById";
        }
      } catch {}
    }

    // 2. _lineDataSources
    if (!source && chart._lineDataSources) {
      if (typeof chart._lineDataSources.get === "function") {
        source = chart._lineDataSources.get(shape.id);
        if (source) strategyUsed = "chart._lineDataSources.get";
      } else if (Array.isArray(chart._lineDataSources)) {
        source = chart._lineDataSources.find((s) => s.id === shape.id || s._id === shape.id);
        if (source) strategyUsed = "chart._lineDataSources.find";
      } else if (typeof chart._lineDataSources === "object") {
        source = chart._lineDataSources[shape.id];
        if (source) strategyUsed = "chart._lineDataSources[id]";
      }
    }

    // 3. _model
    if (!source && (chart._model || (typeof chart.model === "function" && chart.model()))) {
      const model = chart._model || chart.model();
      for (const m of ["dataSourceForId", "lineDataSourceForId", "getLineDataSourceById"]) {
        if (typeof model[m] === "function") {
          try {
            const res = model[m](shape.id);
            if (res) {
              source = res;
              strategyUsed = `model.${m}`;
              break;
            }
          } catch {}
        }
      }
    }

    if (!source) {
      results.push({
        id: shape.id,
        type: shape.name,
        status: "FAILED_TO_RESOLVE_SOURCE",
        strategy: "none",
        entry: null,
        stopLoss: null,
        takeProfit: null,
        rr: null,
      });
      continue;
    }

    const actual = source._source || source;
    const props = actual._properties || (typeof actual.properties === "function" ? actual.properties() : actual.properties);

    if (!props) {
      results.push({
        id: shape.id,
        type: shape.name,
        status: "NO_PROPERTIES",
        strategy: strategyUsed,
        entry: null,
        stopLoss: null,
        takeProfit: null,
        rr: null,
      });
      continue;
    }

    const getVal = (p) => (typeof p?.value === "function" ? p.value() : typeof p?.value === "number" ? p.value : typeof p === "number" ? p : null);
    const entry = getVal(props.entryPrice);
    const stopLoss = getVal(props.stopPrice);
    const takeProfit = getVal(props.targetPrice);

    let rr = null;
    if (entry !== null && stopLoss !== null && takeProfit !== null) {
      const risk = Math.abs(entry - stopLoss);
      const reward = Math.abs(takeProfit - entry);
      rr = risk > 0 ? (reward / risk).toFixed(2) : "N/A";
    }

    results.push({
      id: shape.id,
      type: shape.name,
      status: "SUCCESS",
      strategy: strategyUsed,
      entry,
      stopLoss,
      takeProfit,
      rr,
    });
  }

  console.table(results);

  const successCount = results.filter((r) => r.status === "SUCCESS").length;
  console.log(
    `%cVerification Result: ${successCount} / ${positionShapes.length} position drawings successfully extracted!`,
    successCount === positionShapes.length ? "color: #43a047; font-weight: bold;" : "color: #e53935; font-weight: bold;"
  );
})();
