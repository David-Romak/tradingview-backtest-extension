import type { TradeAnalysisResult } from "../analysis/types";
import { formatDateTime } from "../analysis/analyzer";
import type { PositionWithMetadata } from "../metadata/types";
import { getPipSize } from "../rr/calculator";

export const CSV_HEADER =
  "date,type,Break-time entry-time,bias,entry price,tp,sl,result,at,dd,RR,notes,MFE,MAE";

export interface CSVTradeRow {
  date: string;
  type: string;
  breakTimeEntryTime: string;
  bias: "buy" | "sell";
  entryPrice: number;
  tp: number;
  sl: number;
  result: string;
  at: string;
  dd: number;
  rr: number;
  notes: string;
  mfe: number;
  mae: number;
}

export function escapeCSVField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatCSVRow(row: CSVTradeRow): string {
  return [
    escapeCSVField(row.date),
    escapeCSVField(row.type),
    escapeCSVField(row.breakTimeEntryTime),
    escapeCSVField(row.bias),
    escapeCSVField(row.entryPrice),
    escapeCSVField(row.tp),
    escapeCSVField(row.sl),
    escapeCSVField(row.result),
    escapeCSVField(row.at),
    escapeCSVField(row.dd),
    escapeCSVField(row.rr),
    escapeCSVField(row.notes),
    escapeCSVField(row.mfe),
    escapeCSVField(row.mae),
  ].join(",");
}

export function createCSVTradeRow(
  position: PositionWithMetadata,
  analysis?: TradeAnalysisResult,
  symbol?: string,
  timezone?: string,
): CSVTradeRow {
  const bias: "buy" | "sell" = position.type === "long_position" ? "buy" : "sell";
  const pipSize = getPipSize(symbol, position.prices.entry);

  if (analysis) {
    return {
      date: analysis.entryDateStr || formatDateTime(position.entryTime, timezone),
      type: position.metadata?.type || "",
      breakTimeEntryTime: position.metadata?.breakEntryTime || "",
      bias,
      entryPrice: position.prices.entry,
      tp: analysis.tpPips,
      sl: analysis.slPips,
      result: analysis.result,
      at: analysis.outcomeDateStr || "",
      dd: analysis.ddPips,
      rr: analysis.actualRR,
      notes: position.metadata?.notes || "",
      mfe: analysis.mfePips,
      mae: analysis.maePips,
    };
  }

  // Fallback when analysis is not yet run
  const tpDistance = Math.abs(position.prices.takeProfit - position.prices.entry);
  const slDistance = Math.abs(position.prices.entry - position.prices.stopLoss);
  const tpPips = Number((tpDistance / pipSize).toFixed(1));
  const slPips = Number((slDistance / pipSize).toFixed(1));
  const actualRR = slDistance > 0 ? Number((tpDistance / slDistance).toFixed(4)) : 0;

  return {
    date: formatDateTime(position.entryTime, timezone),
    type: position.metadata?.type || "",
    breakTimeEntryTime: position.metadata?.breakEntryTime || "",
    bias,
    entryPrice: position.prices.entry,
    tp: tpPips,
    sl: slPips,
    result: "OPEN",
    at: "",
    dd: 0,
    rr: actualRR,
    notes: position.metadata?.notes || "",
    mfe: 0,
    mae: 0,
  };
}

export function generateCSV(rows: CSVTradeRow[]): string {
  const lines = [CSV_HEADER, ...rows.map(formatCSVRow)];
  return lines.join("\n");
}

export function exportPositionsToCSV(
  positions: PositionWithMetadata[],
  analysisResults?: Map<string, TradeAnalysisResult>,
  symbol?: string,
  timezone?: string,
): string {
  const rows = positions.map((p) =>
    createCSVTradeRow(p, analysisResults?.get(p.id), symbol, timezone),
  );
  return generateCSV(rows);
}

export function downloadCSV(csvContent: string, filename?: string): void {
  if (typeof document === "undefined") return;
  const name =
    filename ||
    `tradingview-backtest-${new Date().toISOString().slice(0, 10)}.csv`;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
