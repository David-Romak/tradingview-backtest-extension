import type { PositionDrawing } from "../tradingview/types";

export interface TradeMetadata {
  type: string;
  breakEntryTime: string;
  notes: string;
  updatedAt?: number;
}

export interface StoredDrawingRecord {
  drawingId: string;
  symbol?: string;
  positionType: PositionDrawing["type"];
  prices: PositionDrawing["prices"];
  entryTime?: number;
  metadata: TradeMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface PositionWithMetadata extends PositionDrawing {
  metadata: TradeMetadata;
}

export interface StorageAdapter {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear?(): Promise<void>;
}
