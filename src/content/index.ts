import { BRIDGE_CHANNEL, BRIDGE_MESSAGE_TYPES } from "../shared/constants";
import type { DrawingsUpdatedMessage } from "../tradingview/types";

console.log(
  "%c[Backtest Assistant] Content script loaded in ISOLATED world",
  "color: #43a047; font-weight: bold",
);

const globalObj = window as unknown as Record<string, unknown>;
if (!globalObj.__BACKTEST_ASSISTANT_CONTENT_INITIALIZED__) {
  globalObj.__BACKTEST_ASSISTANT_CONTENT_INITIALIZED__ = true;

  window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  const message = event.data;
  if (!message || message.channel !== BRIDGE_CHANNEL) return;

  if (message.type === BRIDGE_MESSAGE_TYPES.DRAWINGS_UPDATED) {
    const update = message as DrawingsUpdatedMessage;
    const { totalDrawings, positions, timestamp } = update.payload;

    console.log(
      `[Backtest Assistant] Snapshot received from page bridge [${new Date(timestamp).toLocaleTimeString()}]: ` +
      `${positions.length} position drawings (total chart drawings: ${totalDrawings})`,
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
  }
});
}
