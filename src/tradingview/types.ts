import type { BRIDGE_CHANNEL, BRIDGE_MESSAGE_TYPES } from "../shared/constants";

export type PositionType = "long_position" | "short_position";

export interface PositionPrices {
  entry: number;
  stopLoss: number;
  takeProfit: number;
}

export interface PositionPoint {
  time: number;
  price: number;
  index?: number;
}

export interface PositionDrawing {
  id: string;
  type: PositionType;
  prices: PositionPrices;
  points?: PositionPoint[];
  entryTime?: number;
}

export interface TradingViewShape {
  id: string;
  name: string;
}

export interface TradingViewPriceProperty {
  value(): number;
  setValue?(val: number): void;
}

export interface TradingViewSourceProperties {
  entryPrice?: TradingViewPriceProperty | number;
  stopPrice?: TradingViewPriceProperty | number;
  targetPrice?: TradingViewPriceProperty | number;
  [key: string]: unknown;
}

export interface TradingViewSource {
  id?: string | (() => string);
  _id?: string;
  name?: string;
  _properties?: TradingViewSourceProperties;
  _source?: TradingViewSource;
  properties?: () => TradingViewSourceProperties;
  points?: () => PositionPoint[];
  _points?: PositionPoint[];
  [key: string]: unknown;
}

export interface TradingViewChart {
  getAllShapes(): TradingViewShape[];
  getShapeById?(id: string): unknown;
  _lineDataSources?: Map<string, unknown> | unknown[] | Record<string, unknown>;
  _model?: unknown;
  model?(): unknown;
  panes?(): unknown[];
  [key: string]: unknown;
}

export interface TradingViewApi {
  activeChart?(): TradingViewChart;
  [key: string]: unknown;
}

export interface DrawingsUpdatedPayload {
  totalDrawings: number;
  positions: PositionDrawing[];
  symbol?: string;
  chartTimezone?: string;
  timestamp: number;
}

export interface DrawingsUpdatedMessage {
  channel: typeof BRIDGE_CHANNEL;
  type: typeof BRIDGE_MESSAGE_TYPES.DRAWINGS_UPDATED;
  payload: DrawingsUpdatedPayload;
}

export interface SetStopLossPayload {
  drawingId: string;
  stopLoss: number;
}

export interface SetStopLossMessage {
  channel: typeof BRIDGE_CHANNEL;
  type: typeof BRIDGE_MESSAGE_TYPES.SET_STOP_LOSS;
  payload: SetStopLossPayload;
}

export interface RequestHistoricalAnalysisMessage {
  channel: typeof BRIDGE_CHANNEL;
  type: typeof BRIDGE_MESSAGE_TYPES.REQUEST_HISTORICAL_ANALYSIS;
}

export interface HistoricalAnalysisResultMessage {
  channel: typeof BRIDGE_CHANNEL;
  type: typeof BRIDGE_MESSAGE_TYPES.HISTORICAL_ANALYSIS_RESULT;
  payload: {
    results: import("../analysis/types").TradeAnalysisResult[];
    totalCandles: number;
    chartTimezone?: string;
    timestamp: number;
  };
}

export type BridgeMessage =
  | DrawingsUpdatedMessage
  | SetStopLossMessage
  | RequestHistoricalAnalysisMessage
  | HistoricalAnalysisResultMessage;