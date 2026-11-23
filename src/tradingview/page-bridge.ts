import { analyzeTrade } from "../analysis/analyzer";
import { BRIDGE_CHANNEL, BRIDGE_MESSAGE_TYPES } from "../shared/constants";
import { TradingViewAdapter } from "./adapter";
import { DrawingObserver } from "./drawings";
import type { BridgeMessage, DrawingsUpdatedMessage } from "./types";

console.log(
  "%c[Backtest Assistant: Page Bridge] Loaded in MAIN world",
  "color: #1e88e5; font-weight: bold",
);

const globalObj = window as unknown as Record<string, unknown>;
if (globalObj.__BACKTEST_ASSISTANT_PAGE_BRIDGE_INITIALIZED__) {
  console.log(
    "[Backtest Assistant: Page Bridge] Already initialized; skipping duplicate execution",
  );
} else {
  globalObj.__BACKTEST_ASSISTANT_PAGE_BRIDGE_INITIALIZED__ = true;

  const adapter = new TradingViewAdapter();
  const observer = new DrawingObserver(adapter, { pollIntervalMs: 1000 });

// Start observing chart drawings
observer.start((positions, totalDrawings) => {
  let symbol: string | undefined;
  const chart = adapter.getActiveChart();
  if (chart) {
    const chartObj = chart as Record<string, unknown>;
    if (typeof chartObj.symbol === "function") {
      try {
        symbol = String((chartObj.symbol as () => unknown)());
      } catch {}
    }
  }

  const message: DrawingsUpdatedMessage = {
    channel: BRIDGE_CHANNEL,
    type: BRIDGE_MESSAGE_TYPES.DRAWINGS_UPDATED,
    payload: {
      totalDrawings,
      positions,
      symbol,
      timestamp: Date.now(),
    },
  };

  window.postMessage(message, window.location.origin);

  console.log(
    `[Backtest Assistant: Page Bridge] Published update: ${positions.length} position drawings extracted (total drawings: ${totalDrawings})`,
  );

  if (positions.length > 0) {
    console.table(
      positions.map((p) => ({
        id: p.id,
        type: p.type,
        entry: p.prices.entry,
        stopLoss: p.prices.stopLoss,
        takeProfit: p.prices.takeProfit,
        entryTime: p.entryTime ? new Date(p.entryTime * 1000).toISOString() : "N/A",
      })),
    );
  }
});

// Listen for incoming messages from ISOLATED world (e.g., RR automation updates)
window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  const data = event.data as BridgeMessage | undefined;
  if (!data || data.channel !== BRIDGE_CHANNEL) return;

  if (data.type === BRIDGE_MESSAGE_TYPES.SET_STOP_LOSS) {
    const chart = adapter.getActiveChart();
    if (!chart) {
      console.warn("[Backtest Assistant: Page Bridge] Cannot set SL: active chart not found");
      return;
    }

    const { drawingId, stopLoss } = data.payload;
    console.log(
      `[Backtest Assistant: Page Bridge] Applying stop-loss update to ${drawingId}: ${stopLoss}`,
    );

    const success = adapter.setStopLoss(chart, drawingId, stopLoss);
    if (!success) {
      console.warn(
        `[Backtest Assistant: Page Bridge] Failed to set stop loss on ${drawingId}`,
      );
    }
  }

  if (data.type === BRIDGE_MESSAGE_TYPES.REQUEST_HISTORICAL_ANALYSIS) {
    const chart = adapter.getActiveChart();
    if (!chart) {
      console.warn("[Backtest Assistant: Page Bridge] Cannot analyze: active chart not found");
      return;
    }

    const positions = adapter.getPositionDrawings(chart);
    const candles = await adapter.getCandleData(chart);
    const chartObj = chart as Record<string, unknown>;
    let symbol: string | undefined;
    if (typeof chartObj.symbol === "function") {
      try {
        symbol = String((chartObj.symbol as () => unknown)());
      } catch {}
    }

    console.log(
      `[Backtest Assistant: Page Bridge] Running historical analysis for ${positions.length} trades with ${candles.length} historical candles...`,
    );

    const results = positions.map((pos) => {
      let entryTime = pos.entryTime ?? 0;
      if (entryTime === 0 && pos.points && pos.points.length > 0) {
        if (pos.points[0].time && pos.points[0].time > 0) {
          entryTime = pos.points[0].time;
        } else if (typeof pos.points[0].index === "number" && candles.length > 0) {
          const idx = pos.points[0].index;
          if (idx >= 0 && idx < candles.length) {
            entryTime = candles[idx].time;
          }
        }
      }

      return analyzeTrade({
        drawingId: pos.id,
        type: pos.type,
        entry: pos.prices.entry,
        stopLoss: pos.prices.stopLoss,
        takeProfit: pos.prices.takeProfit,
        entryTime,
        symbol,
        candles,
      });
    });

    window.postMessage(
      {
        channel: BRIDGE_CHANNEL,
        type: BRIDGE_MESSAGE_TYPES.HISTORICAL_ANALYSIS_RESULT,
        payload: {
          results,
          totalCandles: candles.length,
          timestamp: Date.now(),
        },
      },
      window.location.origin,
    );

    console.log(
      `[Backtest Assistant: Page Bridge] Historical analysis complete (${results.length} trades evaluated):`,
    );
    console.table(
      results.map((r) => ({
        id: r.drawingId,
        bias: r.bias,
        result: r.result,
        at: r.outcomeDateStr ?? "N/A",
        actualRR: `1:${r.actualRR}`,
        tpPips: r.tpPips,
        slPips: r.slPips,
        mfePips: r.mfePips,
        maePips: r.maePips,
        ddPips: r.ddPips,
      })),
    );
  }
});
}
