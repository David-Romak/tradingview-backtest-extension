import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TradingViewAdapter } from "../src/tradingview/adapter";
import type {
  TradingViewChart,
  TradingViewShape,
  TradingViewSource,
} from "../src/tradingview/types";

function createMockSource(params: {
  id: string;
  name: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  entryTime?: number;
}): TradingViewSource {
  let sl = params.stopLoss;
  let tp = params.takeProfit;

  return {
    id: params.id,
    name: params.name,
    _properties: {
      entryPrice: { value: () => params.entry },
      stopPrice: {
        value: () => sl,
        setValue: (val: number) => {
          sl = val;
        },
      },
      targetPrice: {
        value: () => tp,
        setValue: (val: number) => {
          tp = val;
        },
      },
    },
    points: () => [
      { time: params.entryTime ?? 1700000000, price: params.entry, index: 0 },
      { time: (params.entryTime ?? 1700000000) + 3600, price: params.entry, index: 1 },
      { time: (params.entryTime ?? 1700000000) + 3600, price: sl, index: 2 },
      { time: (params.entryTime ?? 1700000000) + 3600, price: tp, index: 3 },
    ],
  };
}

describe("TradingViewAdapter", () => {
  const adapter = new TradingViewAdapter();

  const fourPositionsData = [
    {
      id: "HnuPOQ",
      name: "long_position",
      entry: 1.0850,
      stopLoss: 1.0820,
      takeProfit: 1.0895,
      entryTime: 1700000000,
    },
    {
      id: "HcB3rI",
      name: "short_position",
      entry: 1.0920,
      stopLoss: 1.0950,
      takeProfit: 1.0875,
      entryTime: 1700010000,
    },
    {
      id: "K9xLa2",
      name: "long_position",
      entry: 1.0780,
      stopLoss: 1.0760,
      takeProfit: 1.0810,
      entryTime: 1700020000,
    },
    {
      id: "P4mZw1",
      name: "short_position",
      entry: 1.1000,
      stopLoss: 1.1040,
      takeProfit: 1.0940,
      entryTime: 1700030000,
    },
  ];

  const shapes: TradingViewShape[] = [
    ...fourPositionsData.map((p) => ({ id: p.id, name: p.name })),
    { id: "TL_1", name: "trend_line" },
    { id: "FIB_1", name: "fib_retracement" },
  ];

  it("extracts all four position drawings when sources are in _lineDataSources Map", () => {
    const sourceMap = new Map<string, TradingViewSource>();
    for (const pos of fourPositionsData) {
      sourceMap.set(pos.id, createMockSource(pos));
    }

    const chart: TradingViewChart = {
      getAllShapes: () => shapes,
      _lineDataSources: sourceMap,
    };

    const results = adapter.getPositionDrawings(chart);

    assert.strictEqual(results.length, 4);
    assert.strictEqual(results[0]?.id, "HnuPOQ");
    assert.strictEqual(results[0]?.type, "long_position");
    assert.strictEqual(results[0]?.prices.entry, 1.0850);
    assert.strictEqual(results[0]?.prices.stopLoss, 1.0820);
    assert.strictEqual(results[0]?.prices.takeProfit, 1.0895);
    assert.strictEqual(results[0]?.entryTime, 1700000000);

    assert.strictEqual(results[1]?.id, "HcB3rI");
    assert.strictEqual(results[1]?.type, "short_position");
    assert.strictEqual(results[1]?.prices.entry, 1.0920);
    assert.strictEqual(results[1]?.prices.stopLoss, 1.0950);
    assert.strictEqual(results[1]?.prices.takeProfit, 1.0875);
    assert.strictEqual(results[1]?.entryTime, 1700010000);

    assert.strictEqual(results[2]?.id, "K9xLa2");
    assert.strictEqual(results[2]?.prices.entry, 1.0780);

    assert.strictEqual(results[3]?.id, "P4mZw1");
    assert.strictEqual(results[3]?.prices.entry, 1.1000);
  });

  it("resolves sources via getShapeById(id) entity wrapper", () => {
    const sourceMap = new Map<string, unknown>();
    for (const pos of fourPositionsData) {
      // Entity wrapper holding _source
      sourceMap.set(pos.id, {
        _source: createMockSource(pos),
      });
    }

    const chart: TradingViewChart = {
      getAllShapes: () => shapes,
      getShapeById: (id: string) => sourceMap.get(id),
    };

    const results = adapter.getPositionDrawings(chart);
    assert.strictEqual(results.length, 4);
    assert.strictEqual(results[0]?.id, "HnuPOQ");
    assert.strictEqual(results[0]?.prices.entry, 1.0850);
  });

  it("resolves sources via chart._model.dataSourceForId", () => {
    const sourceMap = new Map<string, TradingViewSource>();
    for (const pos of fourPositionsData) {
      sourceMap.set(pos.id, createMockSource(pos));
    }

    const chart: TradingViewChart = {
      getAllShapes: () => shapes,
      _model: {
        dataSourceForId: (id: string) => sourceMap.get(id),
      },
    };

    const results = adapter.getPositionDrawings(chart);
    assert.strictEqual(results.length, 4);
    assert.strictEqual(results[1]?.id, "HcB3rI");
    assert.strictEqual(results[1]?.prices.stopLoss, 1.0950);
  });

  it("resolves sources from chart._model.panes() collections", () => {
    const sourceList = fourPositionsData.map((p) => createMockSource(p));

    const chart: TradingViewChart = {
      getAllShapes: () => shapes,
      _model: {
        panes: () => [
          {
            sources: () => sourceList,
          },
        ],
      },
    };

    const results = adapter.getPositionDrawings(chart);
    assert.strictEqual(results.length, 4);
  });

  it("ignores non-position shapes like trend_line and fib_retracement", () => {
    const nonPositionShapes: TradingViewShape[] = [
      { id: "TL_1", name: "trend_line" },
      { id: "FIB_1", name: "fib_retracement" },
      { id: "RECT_1", name: "rectangle" },
    ];

    const chart: TradingViewChart = {
      getAllShapes: () => nonPositionShapes,
      _lineDataSources: new Map(),
    };

    const results = adapter.getPositionDrawings(chart);
    assert.strictEqual(results.length, 0);
  });

  it("handles missing or corrupted drawing properties gracefully without throwing", () => {
    const chart: TradingViewChart = {
      getAllShapes: () => [{ id: "bad_1", name: "long_position" }],
      _lineDataSources: new Map([
        [
          "bad_1",
          {
            id: "bad_1",
            _properties: {
              // Missing stopPrice and targetPrice
              entryPrice: { value: () => 1.085 },
            },
          },
        ],
      ]),
    };

    const results = adapter.getPositionDrawings(chart);
    assert.strictEqual(results.length, 0);
  });

  it("updates stop loss price via setStopLoss", () => {
    const mock = createMockSource(fourPositionsData[0]!);
    const chart: TradingViewChart = {
      getAllShapes: () => [shapes[0]!],
      _lineDataSources: new Map([[fourPositionsData[0]!.id, mock]]),
    };

    const success = adapter.setStopLoss(chart, fourPositionsData[0]!.id, 1.0835);
    assert.strictEqual(success, true);

    const updated = adapter.getPositionDrawings(chart);
    assert.strictEqual(updated[0]?.prices.stopLoss, 1.0835);
  });
});
