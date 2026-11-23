import { TradingViewAdapter } from "./adapter";
import type { PositionDrawing, PositionType, TradingViewChart } from "./types";

export interface PositionFingerprint {
  id: string;
  type: PositionType;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  entryTime?: number;
}

export interface DrawingObserverOptions {
  pollIntervalMs?: number;
}

export type DrawingChangeCallback = (
  positions: PositionDrawing[],
  totalDrawings: number,
) => void;

const PRICE_EPSILON = 1e-7;

export function arePricesEqual(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  return Math.abs(a - b) < PRICE_EPSILON;
}

export function areFingerprintsEqual(
  a: PositionFingerprint,
  b: PositionFingerprint,
): boolean {
  if (a.id !== b.id || a.type !== b.type) {
    return false;
  }
  if (!arePricesEqual(a.entry, b.entry)) {
    return false;
  }
  if (!arePricesEqual(a.stopLoss, b.stopLoss)) {
    return false;
  }
  if (!arePricesEqual(a.takeProfit, b.takeProfit)) {
    return false;
  }
  if (a.entryTime !== b.entryTime) {
    return false;
  }
  return true;
}

export function arePositionSnapshotsEqual(
  prev: Map<string, PositionFingerprint> | null,
  curr: Map<string, PositionFingerprint>,
): boolean {
  if (prev === null) {
    return false;
  }
  if (prev.size !== curr.size) {
    return false;
  }
  for (const [id, currFp] of curr) {
    const prevFp = prev.get(id);
    if (!prevFp) {
      return false;
    }
    if (!areFingerprintsEqual(prevFp, currFp)) {
      return false;
    }
  }
  return true;
}

export function describeSnapshotDiff(
  prev: Map<string, PositionFingerprint> | null,
  curr: Map<string, PositionFingerprint>,
): string {
  if (prev === null) {
    return `Initial snapshot (${curr.size} positions)`;
  }
  if (prev.size !== curr.size) {
    return `Position count changed: ${prev.size} -> ${curr.size}`;
  }

  for (const [id, currFp] of curr) {
    const prevFp = prev.get(id);
    if (!prevFp) {
      return `Position ${id} replaced or added`;
    }
    if (currFp.type !== prevFp.type) {
      return `Position ${id} type changed: ${prevFp.type} -> ${currFp.type}`;
    }
    if (!arePricesEqual(prevFp.entry, currFp.entry)) {
      return `Position ${id} entry changed: ${prevFp.entry} -> ${currFp.entry}`;
    }
    if (!arePricesEqual(prevFp.stopLoss, currFp.stopLoss)) {
      return `Position ${id} stop-loss changed: ${prevFp.stopLoss} -> ${currFp.stopLoss}`;
    }
    if (!arePricesEqual(prevFp.takeProfit, currFp.takeProfit)) {
      return `Position ${id} take-profit changed: ${prevFp.takeProfit} -> ${currFp.takeProfit}`;
    }
    if (prevFp.entryTime !== currFp.entryTime) {
      return `Position ${id} entry time changed: ${prevFp.entryTime} -> ${currFp.entryTime}`;
    }
  }

  return "No change";
}

export class DrawingObserver {
  private adapter: TradingViewAdapter;
  private previousSnapshot: Map<string, PositionFingerprint> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;
  private isScanning = false;

  constructor(
    adapter?: TradingViewAdapter,
    options?: DrawingObserverOptions,
  ) {
    this.adapter = adapter ?? new TradingViewAdapter();
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
  }

  start(onChange: DrawingChangeCallback): void {
    if (this.intervalId !== null) {
      return;
    }

    const scan = () => {
      if (this.isScanning) return;
      this.isScanning = true;

      try {
        const chart = this.adapter.getActiveChart();
        if (!chart) {
          return;
        }

        const rawPositions = this.adapter.getPositionDrawings(chart);

        // Sort deterministically by ID to ensure stable order
        const positions = [...rawPositions].sort((a, b) =>
          a.id.localeCompare(b.id),
        );

        const currentSnapshot = new Map<string, PositionFingerprint>();
        for (const pos of positions) {
          currentSnapshot.set(pos.id, {
            id: pos.id,
            type: pos.type,
            entry: pos.prices.entry,
            stopLoss: pos.prices.stopLoss,
            takeProfit: pos.prices.takeProfit,
            entryTime: pos.entryTime,
          });
        }

        // Compare against previous snapshot
        // If identical, suppress publication completely
        if (arePositionSnapshotsEqual(this.previousSnapshot, currentSnapshot)) {
          return;
        }

        const reason = describeSnapshotDiff(
          this.previousSnapshot,
          currentSnapshot,
        );

        // Update stored snapshot
        this.previousSnapshot = currentSnapshot;

        const totalDrawings =
          typeof chart.getAllShapes === "function"
            ? (chart.getAllShapes() ?? []).length
            : positions.length;

        console.log(
          `[Backtest Assistant] Drawing change detected: ${reason} (publishing ${positions.length} positions)`,
        );

        onChange(positions, totalDrawings);
      } catch (err) {
        console.warn("[Backtest Assistant] Drawing scan error:", err);
      } finally {
        this.isScanning = false;
      }
    };

    // Immediate initial scan
    scan();

    // Regular polling for changes and delayed chart restoration
    this.intervalId = setInterval(scan, this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.previousSnapshot = null;
  }

  forceScan(
    chart: TradingViewChart,
    onChange: DrawingChangeCallback,
  ): void {
    const rawPositions = this.adapter.getPositionDrawings(chart);
    const positions = [...rawPositions].sort((a, b) =>
      a.id.localeCompare(b.id),
    );

    const currentSnapshot = new Map<string, PositionFingerprint>();
    for (const pos of positions) {
      currentSnapshot.set(pos.id, {
        id: pos.id,
        type: pos.type,
        entry: pos.prices.entry,
        stopLoss: pos.prices.stopLoss,
        takeProfit: pos.prices.takeProfit,
        entryTime: pos.entryTime,
      });
    }

    if (arePositionSnapshotsEqual(this.previousSnapshot, currentSnapshot)) {
      return;
    }

    this.previousSnapshot = currentSnapshot;
    const totalDrawings =
      typeof chart.getAllShapes === "function"
        ? (chart.getAllShapes() ?? []).length
        : positions.length;

    onChange(positions, totalDrawings);
  }
}
