import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeTrade, formatDateOnly, formatDateTime } from "../src/analysis/analyzer";
import type { CandleBar, TradeAnalysisInput } from "../src/analysis/types";
import { TradingViewAdapter } from "../src/tradingview/adapter";

describe("Historical Candle Analysis Engine", () => {
  const baseEntryTime = 1700000000; // Reference timestamp

  describe("formatDateTime and formatDateOnly", () => {
    it("formats unix timestamp in seconds to UTC YYYY-MM-DD HH:mm", () => {
      // 1700000000 = 2023-11-14 22:13:20 UTC
      const formatted = formatDateTime(baseEntryTime);
      assert.equal(formatted, "2023-11-14 22:13");
    });

    it("formats date only to UTC YYYY-MM-DD", () => {
      const formatted = formatDateOnly(baseEntryTime);
      assert.equal(formatted, "2023-11-14");
    });

    it("handles missing or invalid timestamps gracefully", () => {
      assert.equal(formatDateTime(undefined), "");
      assert.equal(formatDateTime(0), "");
      assert.equal(formatDateOnly(undefined), "");
    });
  });

  describe("BUY (long_position) Outcome Evaluation", () => {
    it("detects TP hit with correct MFE, MAE, and DD (TP => DD = MAE)", () => {
      // EURUSD BUY at 1.08500, SL at 1.08000 (50 pips), TP at 1.09250 (75 pips, 1.5 RR)
      const candles: CandleBar[] = [
        // Bar 1: Entry candle, price dips slightly to 1.08450 (5 pips adverse), rises to 1.08700 (20 pips favorable)
        { time: baseEntryTime, open: 1.085, high: 1.087, low: 1.0845, close: 1.0865 },
        // Bar 2: Further pullback to 1.08300 (20 pips adverse), high 1.08800 (30 pips favorable)
        { time: baseEntryTime + 3600, open: 1.0865, high: 1.088, low: 1.083, close: 1.0875 },
        // Bar 3: Rally hits TP at 1.09250 (high 1.09300)
        { time: baseEntryTime + 7200, open: 1.0875, high: 1.093, low: 1.087, close: 1.0928 },
        // Bar 4: After TP reached (should not affect outcome)
        { time: baseEntryTime + 10800, open: 1.0928, high: 1.095, low: 1.075, close: 1.08 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "buy_1",
        type: "long_position",
        entry: 1.085,
        stopLoss: 1.08,
        takeProfit: 1.0925,
        entryTime: baseEntryTime,
        symbol: "FX:EURUSD",
        candles,
      };

      const result = analyzeTrade(input);

      assert.equal(result.result, "TP");
      assert.equal(result.bias, "buy");
      assert.equal(result.outcomeTime, baseEntryTime + 7200);
      assert.equal(result.tpPips, 75.0);
      assert.equal(result.slPips, 50.0);
      assert.equal(result.actualRR, 1.5);
      // MFE: takeProfit - entry = 0.0075 = 75 pips
      assert.equal(result.mfePips, 75.0);
      // MAE: max adverse diff before TP was entry - low (1.0850 - 1.0830 = 20 pips)
      assert.equal(result.maePips, 20.0);
      // User convention: If TP, DD = MAE
      assert.equal(result.ddPips, 20.0);
    });

    it("detects SL hit with correct MFE, MAE, and DD (SL => DD = MFE)", () => {
      // EURUSD BUY at 1.08500, SL at 1.08000 (50 pips), TP at 1.09250 (75 pips)
      const candles: CandleBar[] = [
        // Bar 1: Favorable excursion up to 1.08800 (30 pips favorable)
        { time: baseEntryTime, open: 1.085, high: 1.088, low: 1.0848, close: 1.0875 },
        // Bar 2: Another push up to 1.09000 (50 pips favorable)
        { time: baseEntryTime + 3600, open: 1.0875, high: 1.09, low: 1.086, close: 1.089 },
        // Bar 3: Reversal down, hits SL at 1.08000 (low 1.07900)
        { time: baseEntryTime + 7200, open: 1.089, high: 1.089, low: 1.079, close: 1.0795 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "buy_2",
        type: "long_position",
        entry: 1.085,
        stopLoss: 1.08,
        takeProfit: 1.0925,
        entryTime: baseEntryTime,
        symbol: "FX:EURUSD",
        candles,
      };

      const result = analyzeTrade(input);

      assert.equal(result.result, "SL");
      assert.equal(result.outcomeTime, baseEntryTime + 7200);
      assert.equal(result.tpPips, 75.0);
      assert.equal(result.slPips, 50.0);
      // MFE before hitting SL was 1.0900 - 1.0850 = 50 pips
      assert.equal(result.mfePips, 50.0);
      // MAE is full SL distance: 50 pips
      assert.equal(result.maePips, 50.0);
      // User convention: If SL, DD = MFE (user defined drawdown convention)
      assert.equal(result.ddPips, 50.0);
    });

    it("flags single-bar ambiguous outcome when both TP and SL are touched in the same bar", () => {
      // Massive spike candle: low touches SL (1.08000) and high touches TP (1.09250)
      const candles: CandleBar[] = [
        { time: baseEntryTime, open: 1.085, high: 1.093, low: 1.079, close: 1.086 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "buy_ambiguous",
        type: "long_position",
        entry: 1.085,
        stopLoss: 1.08,
        takeProfit: 1.0925,
        entryTime: baseEntryTime,
        symbol: "FX:EURUSD",
        candles,
      };

      const result = analyzeTrade(input);

      assert.equal(result.result, "AMBIGUOUS");
      assert.equal(result.outcomeTime, baseEntryTime);
      assert.ok(result.notes?.includes("Ambiguous outcome"));
      assert.ok(result.notes?.includes("single candle touched both TP"));
    });

    it("evaluates running trade as OPEN when neither TP nor SL is reached", () => {
      const candles: CandleBar[] = [
        { time: baseEntryTime, open: 1.085, high: 1.089, low: 1.083, close: 1.088 },
        { time: baseEntryTime + 3600, open: 1.088, high: 1.091, low: 1.086, close: 1.0895 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "buy_open",
        type: "long_position",
        entry: 1.085,
        stopLoss: 1.08,
        takeProfit: 1.095,
        entryTime: baseEntryTime,
        symbol: "FX:EURUSD",
        candles,
      };

      const result = analyzeTrade(input);

      assert.equal(result.result, "OPEN");
      assert.equal(result.outcomeTime, undefined);
      // MFE: 1.09100 - 1.08500 = 60 pips
      assert.equal(result.mfePips, 60.0);
      // MAE: 1.08500 - 1.08300 = 20 pips
      assert.equal(result.maePips, 20.0);
      // OPEN => DD = MAE
      assert.equal(result.ddPips, 20.0);
    });

    it("handles zero candles after entry time gracefully as OPEN", () => {
      const candles: CandleBar[] = [
        // Candles all before entry time
        { time: baseEntryTime - 7200, open: 1.085, high: 1.086, low: 1.084, close: 1.085 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "buy_no_data",
        type: "long_position",
        entry: 1.085,
        stopLoss: 1.08,
        takeProfit: 1.0925,
        entryTime: baseEntryTime,
        candles,
      };

      const result = analyzeTrade(input);

      assert.equal(result.result, "OPEN");
      assert.equal(result.mfePips, 0);
      assert.equal(result.maePips, 0);
      assert.equal(result.ddPips, 0);
      assert.ok(result.notes?.includes("No candle data available"));
    });
  });

  describe("SELL (short_position) Outcome Evaluation", () => {
    it("detects TP hit with correct MFE, MAE, and DD (TP => DD = MAE)", () => {
      // USDJPY SELL at 150.00, SL at 151.00 (100 pips), TP at 148.50 (150 pips, 1.5 RR)
      const candles: CandleBar[] = [
        // Bar 1: Pullback up to 150.25 (25 pips adverse), drops to 149.50 (50 pips favorable)
        { time: baseEntryTime, open: 150.0, high: 150.25, low: 149.5, close: 149.7 },
        // Bar 2: Downward move hits TP at 148.50 (low 148.40)
        { time: baseEntryTime + 3600, open: 149.7, high: 149.8, low: 148.4, close: 148.45 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "sell_1",
        type: "short_position",
        entry: 150.0,
        stopLoss: 151.0,
        takeProfit: 148.5,
        entryTime: baseEntryTime,
        symbol: "FX:USDJPY",
        candles,
      };

      const result = analyzeTrade(input);

      assert.equal(result.result, "TP");
      assert.equal(result.bias, "sell");
      assert.equal(result.outcomeTime, baseEntryTime + 3600);
      assert.equal(result.tpPips, 150.0);
      assert.equal(result.slPips, 100.0);
      assert.equal(result.actualRR, 1.5);
      // MFE: entry - takeProfit = 150.0 - 148.5 = 1.50 = 150 pips
      assert.equal(result.mfePips, 150.0);
      // MAE: max adverse before TP was high - entry = 150.25 - 150.0 = 0.25 = 25 pips
      assert.equal(result.maePips, 25.0);
      // User convention: If TP, DD = MAE
      assert.equal(result.ddPips, 25.0);
    });

    it("detects SL hit with correct MFE, MAE, and DD (SL => DD = MFE)", () => {
      // USDJPY SELL at 150.00, SL at 151.00 (100 pips), TP at 148.50
      const candles: CandleBar[] = [
        // Bar 1: Moves favorably down to 149.20 (80 pips favorable)
        { time: baseEntryTime, open: 150.0, high: 150.1, low: 149.2, close: 149.3 },
        // Bar 2: Reversal shoots up and hits SL at 151.00 (high 151.20)
        { time: baseEntryTime + 3600, open: 149.3, high: 151.2, low: 149.3, close: 151.1 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "sell_2",
        type: "short_position",
        entry: 150.0,
        stopLoss: 151.0,
        takeProfit: 148.5,
        entryTime: baseEntryTime,
        symbol: "FX:USDJPY",
        candles,
      };

      const result = analyzeTrade(input);

      assert.equal(result.result, "SL");
      assert.equal(result.outcomeTime, baseEntryTime + 3600);
      assert.equal(result.mfePips, 80.0);
      assert.equal(result.maePips, 100.0);
      // User convention: If SL, DD = MFE
      assert.equal(result.ddPips, 80.0);
    });

    it("flags single-bar ambiguous outcome for SELL when candle touches both TP and SL", () => {
      const candles: CandleBar[] = [
        { time: baseEntryTime, open: 150.0, high: 151.1, low: 148.4, close: 149.8 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "sell_ambiguous",
        type: "short_position",
        entry: 150.0,
        stopLoss: 151.0,
        takeProfit: 148.5,
        entryTime: baseEntryTime,
        symbol: "FX:USDJPY",
        candles,
      };

      const result = analyzeTrade(input);

      assert.equal(result.result, "AMBIGUOUS");
      assert.equal(result.outcomeTime, baseEntryTime);
      assert.ok(result.notes?.includes("Ambiguous outcome"));
    });
  });

  describe("Instrument Pip Sizing & Excursions", () => {
    it("handles XAUUSD (Gold) with 0.1 pip sizing", () => {
      // Gold BUY at 2000.00, SL at 1990.00 (100 pips), TP at 2015.00 (150 pips)
      const candles: CandleBar[] = [
        { time: baseEntryTime, open: 2000.0, high: 2018.0, low: 1998.0, close: 2016.0 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "gold_buy",
        type: "long_position",
        entry: 2000.0,
        stopLoss: 1990.0,
        takeProfit: 2015.0,
        entryTime: baseEntryTime,
        symbol: "OANDA:XAUUSD",
        candles,
      };

      const result = analyzeTrade(input);

      assert.equal(result.result, "TP");
      assert.equal(result.tpPips, 150.0);
      assert.equal(result.slPips, 100.0);
      assert.equal(result.actualRR, 1.5);
      assert.equal(result.mfePips, 150.0);
      assert.equal(result.maePips, 20.0); // 2000 - 1998 = 2.0 / 0.1 = 20 pips
      assert.equal(result.ddPips, 20.0);
    });
  });

  describe("TradingViewAdapter getCandleData", () => {
    const adapter = new TradingViewAdapter();

    it("extracts candle bars via chart.exportData() when available", async () => {
      const mockChart = {
        exportData: async () => ({
          schema: [
            { type: "time", name: "time" },
            { type: "value", sourceType: "series", plotTitle: "open" },
            { type: "value", sourceType: "series", plotTitle: "high" },
            { type: "value", sourceType: "series", plotTitle: "low" },
            { type: "value", sourceType: "series", plotTitle: "close" },
          ],
          data: [
            [1700000000000, 1.085, 1.088, 1.083, 1.087],
            [1700003600000, 1.087, 1.092, 1.086, 1.091],
          ],
        }),
      };

      const candles = await adapter.getCandleData(mockChart);
      assert.equal(candles.length, 2);
      assert.equal(candles[0].time, 1700000000); // Converted from ms
      assert.equal(candles[0].open, 1.085);
      assert.equal(candles[1].high, 1.092);
    });

    it("extracts candle bars from chart._model.mainSeries.bars().all()", async () => {
      const mockChart = {
        _model: {
          mainSeries: () => ({
            bars: () => ({
              all: () => [
                { time: 1700000000, open: 1.085, high: 1.087, low: 1.084, close: 1.086 },
                { time: 1700003600, open: 1.086, high: 1.088, low: 1.085, close: 1.087 },
              ],
            }),
          }),
        },
      };

      const candles = await adapter.getCandleData(mockChart);
      assert.equal(candles.length, 2);
      assert.equal(candles[0].time, 1700000000);
      assert.equal(candles[0].close, 1.086);
      assert.equal(candles[1].time, 1700003600);
    });

    it("extracts candle bars in PlotRow format (rec.value array)", async () => {
      const mockChart = {
        _model: {
          mainSeries: {
            data: () => ({
              _items: [
                { value: [1700000000, 1.085, 1.087, 1.084, 1.086] },
                { value: [1700003600, 1.086, 1.089, 1.085, 1.088] },
              ],
            }),
          },
        },
      };

      const candles = await adapter.getCandleData(mockChart);
      assert.equal(candles.length, 2);
      assert.equal(candles[0].open, 1.085);
      assert.equal(candles[1].high, 1.089);
    });

    it("converts millisecond timestamps to seconds", async () => {
      const mockChart = {
        _model: {
          mainSeries: {
            _bars: [
              { time: 1700000000000, open: 1.08, high: 1.09, low: 1.07, close: 1.085 },
            ],
          },
        },
      };

      const candles = await adapter.getCandleData(mockChart);
      assert.equal(candles.length, 1);
      assert.equal(candles[0].time, 1700000000); // Converted from ms
    });

    it("returns empty array when chart has no series or data", async () => {
      assert.deepEqual(await adapter.getCandleData(null), []);
      assert.deepEqual(await adapter.getCandleData({}), []);
      assert.deepEqual(await adapter.getCandleData({ _model: {} }), []);
    });
  });

  describe("Entry Time Resolution & Edge Cases", () => {
    it("correctly analyzes trade when entryTime is provided in milliseconds", () => {
      const candles: CandleBar[] = [
        { time: 1700000000, open: 1.085, high: 1.093, low: 1.084, close: 1.092 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "ms_test",
        type: "long_position",
        entry: 1.085,
        stopLoss: 1.08,
        takeProfit: 1.0925,
        entryTime: 1700000000000, // Milliseconds!
        symbol: "FX:EURUSD",
        candles,
      };

      const result = analyzeTrade(input);
      assert.equal(result.result, "TP");
      assert.equal(result.entryTime, 1700000000); // Normalized to seconds
    });

    it("evaluates trade on latest forming candle even if entryTime is after candle open timestamp", () => {
      // 1-hour candle open at 1700000000. Entry placed at 1700001500 (25 min into bar)
      const candles: CandleBar[] = [
        { time: 1699996400, open: 1.08, high: 1.084, low: 1.079, close: 1.082 },
        { time: 1700000000, open: 1.085, high: 1.094, low: 1.083, close: 1.093 },
      ];

      const input: TradeAnalysisInput = {
        drawingId: "latest_candle_test",
        type: "long_position",
        entry: 1.085,
        stopLoss: 1.08,
        takeProfit: 1.0925,
        entryTime: 1700001500, // 25 minutes after latest bar open
        symbol: "FX:EURUSD",
        candles,
      };

      const result = analyzeTrade(input);
      assert.equal(result.result, "TP");
      assert.notEqual(result.notes, "No candle data available after entry time");
    });
  });
});
