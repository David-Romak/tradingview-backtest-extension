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
  const message: DrawingsUpdatedMessage = {
    channel: BRIDGE_CHANNEL,
    type: BRIDGE_MESSAGE_TYPES.DRAWINGS_UPDATED,
    payload: {
      totalDrawings,
      positions,
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
window.addEventListener("message", (event: MessageEvent) => {
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
});
}
