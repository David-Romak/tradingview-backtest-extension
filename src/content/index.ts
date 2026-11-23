import { MetadataStore } from "../metadata/store";
import type { PositionWithMetadata, TradeMetadata } from "../metadata/types";
import { RRManager } from "../rr/manager";
import type { RRConfig } from "../rr/types";
import { BRIDGE_CHANNEL, BRIDGE_MESSAGE_TYPES } from "../shared/constants";
import type { DrawingsUpdatedMessage, PositionDrawing } from "../tradingview/types";
import { BacktestPanel } from "./panel";

console.log(
  "%c[Backtest Assistant] Content script loaded in ISOLATED world",
  "color: #43a047; font-weight: bold",
);

const globalObj = window as unknown as Record<string, unknown>;
if (!globalObj.__BACKTEST_ASSISTANT_CONTENT_INITIALIZED__) {
  globalObj.__BACKTEST_ASSISTANT_CONTENT_INITIALIZED__ = true;

  const RR_STORAGE_KEY = "tv_bt_rr_config";
  const store = new MetadataStore();
  let latestPositions: PositionDrawing[] = [];
  let latestSymbol: string | undefined;

  let rrManager: RRManager;

  const panel = new BacktestPanel(
    {
      onMetadataChange: async (drawingId: string, update: Partial<TradeMetadata>) => {
        const pos = latestPositions.find((p) => p.id === drawingId);
        await store.saveMetadata(drawingId, update, {
          positionType: pos?.type,
          prices: pos?.prices,
          entryTime: pos?.entryTime,
          symbol: latestSymbol,
        });
      },
      onCleanupOrphans: async () => {
        const activeIds = latestPositions.map((p) => p.id);
        const cleaned = await store.cleanupOrphans(activeIds);
        if (cleaned.length > 0) {
          const synced = await store.syncWithDrawings(latestPositions, latestSymbol);
          panel.setPositions(synced, latestSymbol);
        }
      },
      onRRConfigChange: (config: RRConfig) => {
        rrManager.setConfig(config, latestPositions, latestSymbol);
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ [RR_STORAGE_KEY]: config });
        }
      },
    },
    { enabled: true, defaultRR: 1.5 },
  );

  rrManager = new RRManager(
    {
      onApplyStopLoss: (drawingId: string, stopLoss: number) => {
        console.log(
          `[Backtest Assistant] Auto-RR applying Stop-Loss to ${drawingId}: ${stopLoss}`,
        );
        window.postMessage(
          {
            channel: BRIDGE_CHANNEL,
            type: BRIDGE_MESSAGE_TYPES.SET_STOP_LOSS,
            payload: { drawingId, stopLoss },
          },
          window.location.origin,
        );
      },
      onConfigChange: (config: RRConfig) => {
        panel.setRRConfig(config);
      },
    },
    { enabled: true, defaultRR: 1.5 },
  );

  // Restore saved RR config from chrome.storage
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get([RR_STORAGE_KEY], (res) => {
      if (res && res[RR_STORAGE_KEY]) {
        const saved = res[RR_STORAGE_KEY] as RRConfig;
        rrManager.setConfig(saved);
        panel.setRRConfig(saved);
      }
    });
  }

  // Mount panel into the page
  panel.mount();

  // Listen for drawing snapshots from page bridge
  window.addEventListener("message", async (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const message = event.data;
    if (!message || message.channel !== BRIDGE_CHANNEL) return;

    if (message.type === BRIDGE_MESSAGE_TYPES.DRAWINGS_UPDATED) {
      const update = message as DrawingsUpdatedMessage;
      const { totalDrawings, positions, symbol, timestamp } = update.payload;

      latestPositions = positions;
      latestSymbol = symbol;

      // Process automatic RR adjustments (only triggers when Entry or TP changes)
      rrManager.processPositions(positions, symbol);

      // Synchronize with metadata store
      const positionsWithMeta = await store.syncWithDrawings(positions, symbol);

      // Update UI panel
      panel.setPositions(positionsWithMeta, symbol);

      console.log(
        `[Backtest Assistant] Snapshot synchronized [${new Date(timestamp).toLocaleTimeString()}]: ` +
        `${positions.length} position drawings with metadata (total chart drawings: ${totalDrawings})` +
        (symbol ? ` [${symbol}]` : ""),
      );

      if (positionsWithMeta.length > 0) {
        console.table(
          positionsWithMeta.map((p: PositionWithMetadata) => ({
            id: p.id,
            type: p.type,
            entry: p.prices.entry,
            stopLoss: p.prices.stopLoss,
            takeProfit: p.prices.takeProfit,
            tradeType: p.metadata.type || "(none)",
            breakTime: p.metadata.breakEntryTime || "(none)",
            notes: p.metadata.notes || "(none)",
          })),
        );
      }
    }
  });
}
