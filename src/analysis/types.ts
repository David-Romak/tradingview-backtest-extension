import type { PositionType } from "../tradingview/types";

export type TradeOutcome = "TP" | "SL" | "AMBIGUOUS" | "OPEN";

export interface CandleBar {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TradeAnalysisInput {
  drawingId: string;
  type: PositionType;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  entryTime: number; // Unix timestamp in seconds
  symbol?: string;
  pipSize?: number;
  candles: CandleBar[];
  /** IANA timezone of the TradingView chart display (e.g. "Europe/Moscow", "UTC"). */
  chartTimezone?: string;
}

export interface TradeAnalysisResult {
  drawingId: string;
  bias: "buy" | "sell";
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  entryTime: number;
  entryDateStr: string;

  // Outcome
  result: TradeOutcome;
  outcomeTime?: number; // Timestamp when TP or SL was reached
  outcomeDateStr?: string;

  // Pip Distances
  tpPips: number;
  slPips: number;
  actualRR: number;

  // Excursion Metrics (in pips)
  mfePips: number; // Maximum Favorable Excursion
  maePips: number; // Maximum Adverse Excursion
  ddPips: number;  // User DD convention: MFE if SL, MAE if TP

  // Ambiguity notes if touched both in same bar
  notes?: string;
}
