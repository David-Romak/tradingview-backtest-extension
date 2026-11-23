import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TradingViewAdapter } from "../src/tradingview/adapter";
import {
  DrawingObserver,
  areFingerprintsEqual,
  arePositionSnapshotsEqual,
  arePricesEqual,
  describeSnapshotDiff,
  type PositionFingerprint,
} from "../src/tradingview/drawings";
import type { PositionDrawing, TradingViewChart, TradingViewSource } from "../src/tradingview/types";

function createMockSource(params: {
  id: string;
  name: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  entryTime?: number;
}): TradingViewSource {
  return {
    id: params.id,
    name: params.name,
    _properties: {
      entryPrice: { value: () => params.entry },
      stopPrice: { value: () => params.stopLoss, setValue: () => {} },
      targetPrice: { value: () => params.takeProfit, setValue: () => {} },
    },
    points: () => [
      { time: params.entryTime ?? 1700000000, price: params.entry, index: 0 },
      { time: (params.entryTime ?? 1700000000) + 3600, price: params.entry, index: 1 },
      { time: (params.entryTime ?? 1700000000) + 3600, price: params.stopLoss, index: 2 },
      { time: (params.entryTime ?? 1700000000) + 3600, price: params.takeProfit, index: 3 },
    ],
  };
}

describe("Snapshot Equality Helpers", () => {
  it("arePricesEqual treats floats within 1e-7 as equal", () => {
    assert.strictEqual(arePricesEqual(1.08500000001, 1.08500000002), true);
    assert.strictEqual(arePricesEqual(1.085, 1.085), true);
    assert.strictEqual(arePricesEqual(1.085, 1.086), false);
    assert.strictEqual(arePricesEqual(NaN, 1.085), false);
  });

  it("areFingerprintsEqual correctly matches identical fingerprints", () => {
    const fp1: PositionFingerprint = {
      id: "HnuPOQ",
      type: "long_position",
      entry: 1.085,
      stopLoss: 1.082,
      takeProfit: 1.0895,
      entryTime: 1700000000,
    };
    const fp2: PositionFingerprint = {
      id: "HnuPOQ",
      type: "long_position",
      entry: 1.08500000001,
      stopLoss: 1.08200000001,
      takeProfit: 1.08950000001,
      entryTime: 1700000000,
    };
    assert.strictEqual(areFingerprintsEqual(fp1, fp2), true);
  });

  it("arePositionSnapshotsEqual returns true for identical snapshot maps", () => {
    const map1 = new Map<string, PositionFingerprint>([
      ["P1", { id: "P1", type: "long_position", entry: 1.1, stopLoss: 1.09, takeProfit: 1.115, entryTime: 100 }],
      ["P2", { id: "P2", type: "short_position", entry: 1.2, stopLoss: 1.21, takeProfit: 1.185, entryTime: 200 }],
    ]);
    const map2 = new Map<string, PositionFingerprint>([
      ["P2", { id: "P2", type: "short_position", entry: 1.2, stopLoss: 1.21, takeProfit: 1.185, entryTime: 200 }],
      ["P1", { id: "P1", type: "long_position", entry: 1.1, stopLoss: 1.09, takeProfit: 1.115, entryTime: 100 }],
    ]);
    assert.strictEqual(arePositionSnapshotsEqual(map1, map2), true);
  });

  it("arePositionSnapshotsEqual returns false if price changes", () => {
    const map1 = new Map<string, PositionFingerprint>([
      ["P1", { id: "P1", type: "long_position", entry: 1.1, stopLoss: 1.09, takeProfit: 1.115 }],
    ]);
    const map2 = new Map<string, PositionFingerprint>([
      ["P1", { id: "P1", type: "long_position", entry: 1.1, stopLoss: 1.092, takeProfit: 1.115 }],
    ]);
    assert.strictEqual(arePositionSnapshotsEqual(map1, map2), false);
    assert.match(describeSnapshotDiff(map1, map2), /stop-loss changed/);
  });
});

describe("DrawingObserver Suppression", () => {
  it("suppresses repeated identical scans and only fires on genuine changes", () => {
    let currentSources: TradingViewSource[] = [
      createMockSource({ id: "P1", name: "long_position", entry: 1.085, stopLoss: 1.082, takeProfit: 1.0895, entryTime: 1700000000 }),
      createMockSource({ id: "P2", name: "short_position", entry: 1.092, stopLoss: 1.095, takeProfit: 1.0875, entryTime: 1700010000 }),
      createMockSource({ id: "P3", name: "long_position", entry: 1.078, stopLoss: 1.076, takeProfit: 1.081, entryTime: 1700020000 }),
      createMockSource({ id: "P4", name: "short_position", entry: 1.1, stopLoss: 1.104, takeProfit: 1.094, entryTime: 1700030000 }),
    ];

    let extraShapes: Array<{ id: string; name: string }> = [];

    const mockChart: TradingViewChart = {
      getAllShapes: () => [
        ...currentSources.map((s) => ({ id: s.id as string, name: s.name as string })),
        ...extraShapes,
      ],
      _lineDataSources: {
        get: (id: string) => currentSources.find((s) => s.id === id),
      } as unknown as Map<string, unknown>,
    };

    class TestAdapter extends TradingViewAdapter {
      override getActiveChart(): TradingViewChart | null {
        return mockChart;
      }
    }

    const testAdapter = new TestAdapter();
    const observer = new DrawingObserver(testAdapter);

    const publishedSnapshots: PositionDrawing[][] = [];

    const onUpdate = (positions: PositionDrawing[]) => {
      publishedSnapshots.push(positions);
    };

    // Scan 1: Initial detection of 4 positions -> MUST publish once
    observer.forceScan(mockChart, onUpdate);
    assert.strictEqual(publishedSnapshots.length, 1);
    assert.strictEqual(publishedSnapshots[0]?.length, 4);

    // Scan 2: Repeated scan with identical positions -> MUST be suppressed (0 new publications)
    observer.forceScan(mockChart, onUpdate);
    assert.strictEqual(publishedSnapshots.length, 1, "Scan 2 should be suppressed");

    // Scan 3: Another repeated scan -> MUST be suppressed
    observer.forceScan(mockChart, onUpdate);
    assert.strictEqual(publishedSnapshots.length, 1, "Scan 3 should be suppressed");

    // Scan 4: User draws a trend line (totalDrawings changes from 4 to 5)
    // Non-position shape change -> MUST be suppressed
    extraShapes = [{ id: "TL1", name: "trend_line" }];
    observer.forceScan(mockChart, onUpdate);
    assert.strictEqual(publishedSnapshots.length, 1, "Adding trend_line should not publish position update");

    // Scan 5: User adjusts Take-Profit on P1 from 1.0895 to 1.0910
    // Genuine price change -> MUST publish exactly once
    currentSources = [
      createMockSource({ id: "P1", name: "long_position", entry: 1.085, stopLoss: 1.082, takeProfit: 1.091, entryTime: 1700000000 }),
      currentSources[1]!,
      currentSources[2]!,
      currentSources[3]!,
    ];
    observer.forceScan(mockChart, onUpdate);
    assert.strictEqual(publishedSnapshots.length, 2, "Price change on P1 must trigger publication");
    assert.strictEqual(publishedSnapshots[1]?.find((p) => p.id === "P1")?.prices.takeProfit, 1.091);

    // Scan 6: Repeated scan after price change -> MUST be suppressed
    observer.forceScan(mockChart, onUpdate);
    assert.strictEqual(publishedSnapshots.length, 2, "Scan after price change must be suppressed");

    // Scan 7: User deletes drawing P4
    // Position count changes 4 -> 3 -> MUST publish exactly once
    currentSources = [currentSources[0]!, currentSources[1]!, currentSources[2]!];
    observer.forceScan(mockChart, onUpdate);
    assert.strictEqual(publishedSnapshots.length, 3, "Deleting a position must trigger publication");
    assert.strictEqual(publishedSnapshots[2]?.length, 3);

    // Scan 8: Repeated scan after deletion -> MUST be suppressed
    observer.forceScan(mockChart, onUpdate);
    assert.strictEqual(publishedSnapshots.length, 3, "Scan after deletion must be suppressed");
  });
});
