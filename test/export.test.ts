import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TradeAnalysisResult } from "../src/analysis/types";
import {
  CSV_HEADER,
  createCSVTradeRow,
  escapeCSVField,
  exportPositionsToCSV,
  formatCSVRow,
  generateCSV,
} from "../src/export/csv";
import type { PositionWithMetadata } from "../src/metadata/types";

describe("CSV Export Engine", () => {
  it("matches the exact spreadsheet schema header", () => {
    assert.equal(
      CSV_HEADER,
      "date,type,Break-time entry-time,bias,entry price,tp,sl,result,at,dd,RR,notes,MFE,MAE",
    );
  });

  describe("escapeCSVField", () => {
    it("returns empty string for null and undefined", () => {
      assert.equal(escapeCSVField(null), "");
      assert.equal(escapeCSVField(undefined), "");
    });

    it("leaves normal alphanumeric strings unquoted", () => {
      assert.equal(escapeCSVField("EURUSD"), "EURUSD");
      assert.equal(escapeCSVField(1.085), "1.085");
      assert.equal(escapeCSVField(0), "0");
    });

    it("quotes fields containing commas", () => {
      assert.equal(escapeCSVField("A0, B0"), '"A0, B0"');
    });

    it("quotes fields containing double quotes and doubles internal quotes", () => {
      assert.equal(
        escapeCSVField('Retest of "London High"'),
        '"Retest of ""London High"""',
      );
    });

    it("quotes fields containing newlines", () => {
      assert.equal(escapeCSVField("First line\nSecond line"), '"First line\nSecond line"');
    });
  });

  describe("createCSVTradeRow", () => {
    const mockPosition: PositionWithMetadata = {
      id: "draw_123",
      type: "long_position",
      prices: {
        entry: 1.085,
        stopLoss: 1.08,
        takeProfit: 1.0925,
      },
      entryTime: 1700000000,
      metadata: {
        type: "A0",
        breakEntryTime: "08:30 - 09:15",
        notes: 'Clean breaker, strong volume',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    };

    it("formats row with analyzed trade outcome and user DD convention", () => {
      const mockAnalysis: TradeAnalysisResult = {
        drawingId: "draw_123",
        bias: "buy",
        entryPrice: 1.085,
        stopLossPrice: 1.08,
        takeProfitPrice: 1.0925,
        entryTime: 1700000000,
        entryDateStr: "2023-11-14 22:13",
        result: "TP",
        outcomeTime: 1700007200,
        outcomeDateStr: "2023-11-15 00:13",
        tpPips: 75.0,
        slPips: 50.0,
        actualRR: 1.5,
        mfePips: 75.0,
        maePips: 15.0,
        ddPips: 15.0, // If TP, DD = MAE
      };

      const row = createCSVTradeRow(mockPosition, mockAnalysis, "FX:EURUSD");

      assert.equal(row.date, "2023-11-14 22:13");
      assert.equal(row.type, "A0");
      assert.equal(row.breakTimeEntryTime, "08:30 - 09:15");
      assert.equal(row.bias, "buy");
      assert.equal(row.entryPrice, 1.085);
      assert.equal(row.tp, 75.0);
      assert.equal(row.sl, 50.0);
      assert.equal(row.result, "TP");
      assert.equal(row.at, "2023-11-15 00:13");
      assert.equal(row.dd, 15.0);
      assert.equal(row.rr, 1.5);
      assert.equal(row.notes, 'Clean breaker, strong volume');
      assert.equal(row.mfe, 75.0);
      assert.equal(row.mae, 15.0);

      const formatted = formatCSVRow(row);
      assert.equal(
        formatted,
        '2023-11-14 22:13,A0,08:30 - 09:15,buy,1.085,75,50,TP,2023-11-15 00:13,15,1.5,"Clean breaker, strong volume",75,15',
      );
    });

    it("formats fallback row when historical analysis has not yet run", () => {
      const row = createCSVTradeRow(mockPosition, undefined, "FX:EURUSD");

      assert.equal(row.date, "2023-11-14 22:13");
      assert.equal(row.type, "A0");
      assert.equal(row.breakTimeEntryTime, "08:30 - 09:15");
      assert.equal(row.bias, "buy");
      assert.equal(row.entryPrice, 1.085);
      assert.equal(row.tp, 75.0);
      assert.equal(row.sl, 50.0);
      assert.equal(row.result, "OPEN");
      assert.equal(row.at, "");
      assert.equal(row.dd, 0);
      assert.equal(row.rr, 1.5);
      assert.equal(row.notes, 'Clean breaker, strong volume');
      assert.equal(row.mfe, 0);
      assert.equal(row.mae, 0);
    });
  });

  describe("exportPositionsToCSV", () => {
    it("generates multi-row CSV document matching header and data rows", () => {
      const pos1: PositionWithMetadata = {
        id: "p1",
        type: "long_position",
        prices: { entry: 1.085, stopLoss: 1.08, takeProfit: 1.0925 },
        entryTime: 1700000000,
        metadata: {
          type: "A0",
          breakEntryTime: "08:30",
          notes: "Trade 1",
          createdAt: 100,
          updatedAt: 100,
        },
      };

      const pos2: PositionWithMetadata = {
        id: "p2",
        type: "short_position",
        prices: { entry: 150.0, stopLoss: 151.0, takeProfit: 148.5 },
        entryTime: 1700003600,
        metadata: {
          type: "WTB",
          breakEntryTime: "09:30",
          notes: "Trade 2, with comma",
          createdAt: 200,
          updatedAt: 200,
        },
      };

      const analysisMap = new Map<string, TradeAnalysisResult>([
        [
          "p1",
          {
            drawingId: "p1",
            bias: "buy",
            entryPrice: 1.085,
            stopLossPrice: 1.08,
            takeProfitPrice: 1.0925,
            entryTime: 1700000000,
            entryDateStr: "2023-11-14 22:13",
            result: "TP",
            outcomeTime: 1700007200,
            outcomeDateStr: "2023-11-15 00:13",
            tpPips: 75.0,
            slPips: 50.0,
            actualRR: 1.5,
            mfePips: 75.0,
            maePips: 10.0,
            ddPips: 10.0,
          },
        ],
        [
          "p2",
          {
            drawingId: "p2",
            bias: "sell",
            entryPrice: 150.0,
            stopLossPrice: 151.0,
            takeProfitPrice: 148.5,
            entryTime: 1700003600,
            entryDateStr: "2023-11-14 23:13",
            result: "SL",
            outcomeTime: 1700010800,
            outcomeDateStr: "2023-11-15 01:13",
            tpPips: 150.0,
            slPips: 100.0,
            actualRR: 1.5,
            mfePips: 40.0,
            maePips: 100.0,
            ddPips: 40.0, // If SL, DD = MFE
          },
        ],
      ]);

      const csv = exportPositionsToCSV([pos1, pos2], analysisMap, "FX:EURUSD");
      const lines = csv.split("\n");

      assert.equal(lines.length, 3);
      assert.equal(lines[0], CSV_HEADER);
      assert.equal(
        lines[1],
        "2023-11-14 22:13,A0,08:30,buy,1.085,75,50,TP,2023-11-15 00:13,10,1.5,Trade 1,75,10",
      );
      assert.equal(
        lines[2],
        '2023-11-14 23:13,WTB,09:30,sell,150,150,100,SL,2023-11-15 01:13,40,1.5,"Trade 2, with comma",40,100',
      );
    });
  });
});
