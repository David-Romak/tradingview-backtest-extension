import { arePricesEqual } from "../tradingview/drawings";
import type { PositionDrawing } from "../tradingview/types";
import { calculateStopLoss } from "./calculator";
import type { RRCalculationResult, RRConfig, RRPositionState } from "./types";

export interface RRManagerCallbacks {
  onApplyStopLoss: (drawingId: string, stopLoss: number) => void;
  onConfigChange?: (config: RRConfig) => void;
}

export const DEFAULT_RR_CONFIG: RRConfig = {
  enabled: true,
  defaultRR: 1.5,
};

export class RRManager {
  private config: RRConfig;
  private callbacks: RRManagerCallbacks;
  private states = new Map<string, RRPositionState>();
  private pendingUpdates = new Map<string, number>();

  constructor(callbacks: RRManagerCallbacks, initialConfig?: Partial<RRConfig>) {
    this.callbacks = callbacks;
    this.config = {
      enabled: initialConfig?.enabled ?? DEFAULT_RR_CONFIG.enabled,
      defaultRR: initialConfig?.defaultRR ?? DEFAULT_RR_CONFIG.defaultRR,
    };
  }

  getConfig(): RRConfig {
    return { ...this.config };
  }

  setConfig(newConfig: Partial<RRConfig>, activePositions?: PositionDrawing[], symbol?: string): void {
    const prevEnabled = this.config.enabled;
    const prevRR = this.config.defaultRR;

    if (typeof newConfig.enabled === "boolean") {
      this.config.enabled = newConfig.enabled;
    }
    if (typeof newConfig.defaultRR === "number" && newConfig.defaultRR > 0) {
      this.config.defaultRR = newConfig.defaultRR;
    }

    if (this.callbacks.onConfigChange) {
      this.callbacks.onConfigChange(this.getConfig());
    }

    // If RR changed or enabled was toggled on, recalculate active positions
    const shouldRecalculate =
      (this.config.enabled && !prevEnabled) ||
      (this.config.enabled && !arePricesEqual(this.config.defaultRR, prevRR));

    if (shouldRecalculate && activePositions && activePositions.length > 0) {
      this.recalculateAll(activePositions, symbol);
    }
  }

  processPositions(positions: PositionDrawing[], symbol?: string): Map<string, RRCalculationResult> {
    const results = new Map<string, RRCalculationResult>();

    if (!this.config.enabled) {
      return results;
    }

    const currentDrawingIds = new Set(positions.map((p) => p.id));

    // Prune stale drawing states
    for (const id of this.states.keys()) {
      if (!currentDrawingIds.has(id)) {
        this.states.delete(id);
        this.pendingUpdates.delete(id);
      }
    }

    for (const pos of positions) {
      const calculation = calculateStopLoss({
        type: pos.type,
        entry: pos.prices.entry,
        takeProfit: pos.prices.takeProfit,
        targetRR: this.config.defaultRR,
        symbol,
      });

      results.set(pos.id, calculation);

      if (!calculation.isValid) {
        continue;
      }

      const pendingSL = this.pendingUpdates.get(pos.id);
      if (pendingSL !== undefined && arePricesEqual(pos.prices.stopLoss, pendingSL)) {
        // Bridge has confirmed the update, clear pending flag
        this.pendingUpdates.delete(pos.id);
      }

      const prevState = this.states.get(pos.id);
      const isNew = !prevState;
      const entryChanged = prevState && !arePricesEqual(prevState.lastEntry, pos.prices.entry);
      const tpChanged = prevState && !arePricesEqual(prevState.lastTP, pos.prices.takeProfit);
      const slNeedsAlignment = !arePricesEqual(pos.prices.stopLoss, calculation.roundedSL);

      // Recalculate when Entry changes, when TP changes, or when new drawing needs initial SL alignment
      if ((isNew && slNeedsAlignment) || entryChanged || tpChanged) {
        this.states.set(pos.id, {
          lastEntry: pos.prices.entry,
          lastTP: pos.prices.takeProfit,
          lastCalculatedSL: calculation.roundedSL,
        });

        // Avoid infinite loop if SL is already at the target
        if (!arePricesEqual(pos.prices.stopLoss, calculation.roundedSL)) {
          this.pendingUpdates.set(pos.id, calculation.roundedSL);
          this.callbacks.onApplyStopLoss(pos.id, calculation.roundedSL);
        }
      } else if (prevState) {
        // Keep state synchronized
        prevState.lastEntry = pos.prices.entry;
        prevState.lastTP = pos.prices.takeProfit;
      }
    }

    return results;
  }

  recalculateAll(positions: PositionDrawing[], symbol?: string): void {
    if (!this.config.enabled) return;

    for (const pos of positions) {
      const calculation = calculateStopLoss({
        type: pos.type,
        entry: pos.prices.entry,
        takeProfit: pos.prices.takeProfit,
        targetRR: this.config.defaultRR,
        symbol,
      });

      if (!calculation.isValid) continue;

      if (!arePricesEqual(pos.prices.stopLoss, calculation.roundedSL)) {
        this.states.set(pos.id, {
          lastEntry: pos.prices.entry,
          lastTP: pos.prices.takeProfit,
          lastCalculatedSL: calculation.roundedSL,
        });
        this.pendingUpdates.set(pos.id, calculation.roundedSL);
        this.callbacks.onApplyStopLoss(pos.id, calculation.roundedSL);
      }
    }
  }

  clear(): void {
    this.states.clear();
    this.pendingUpdates.clear();
  }
}
