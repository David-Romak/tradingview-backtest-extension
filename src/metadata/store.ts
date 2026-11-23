import type { PositionDrawing } from "../tradingview/types";
import type {
  PositionWithMetadata,
  StorageAdapter,
  StoredDrawingRecord,
  TradeMetadata,
} from "./types";

export const METADATA_STORAGE_PREFIX = "tv_bt_meta_";

export function defaultTradeMetadata(): TradeMetadata {
  return {
    type: "",
    breakEntryTime: "",
    notes: "",
    updatedAt: Date.now(),
  };
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, unknown>();

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};

    if (keys === null) {
      for (const [k, v] of this.store.entries()) {
        result[k] = v;
      }
      return result;
    }

    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) {
      if (this.store.has(k)) {
        result[k] = this.store.get(k);
      }
    }
    return result;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      this.store.set(k, v);
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) {
      this.store.delete(k);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

export class ChromeStorageAdapter implements StorageAdapter {
  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return {};
    }
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (items) => {
        resolve(items ?? {});
      });
    });
  }

  async set(items: Record<string, unknown>): Promise<void> {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return;
    }
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => {
        resolve();
      });
    });
  }

  async remove(keys: string | string[]): Promise<void> {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return;
    }
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, () => {
        resolve();
      });
    });
  }

  async clear(): Promise<void> {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      return;
    }
    return new Promise((resolve) => {
      chrome.storage.local.clear(() => {
        resolve();
      });
    });
  }
}

export class MetadataStore {
  private storage: StorageAdapter;
  private cache = new Map<string, StoredDrawingRecord>();
  private isLoaded = false;

  constructor(storage?: StorageAdapter) {
    if (storage) {
      this.storage = storage;
    } else if (typeof chrome !== "undefined" && chrome.storage?.local) {
      this.storage = new ChromeStorageAdapter();
    } else {
      this.storage = new InMemoryStorageAdapter();
    }
  }

  async init(): Promise<void> {
    if (this.isLoaded) return;
    await this.loadAll();
    this.isLoaded = true;
  }

  async loadAll(): Promise<Map<string, StoredDrawingRecord>> {
    const raw = await this.storage.get(null);
    this.cache.clear();

    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith(METADATA_STORAGE_PREFIX) && value && typeof value === "object") {
        const record = value as StoredDrawingRecord;
        if (record.drawingId) {
          this.cache.set(record.drawingId, record);
        }
      }
    }

    return this.cache;
  }

  getMetadata(drawingId: string): TradeMetadata {
    const record = this.cache.get(drawingId);
    if (!record) {
      return defaultTradeMetadata();
    }
    return { ...record.metadata };
  }

  getRecord(drawingId: string): StoredDrawingRecord | null {
    return this.cache.get(drawingId) ?? null;
  }

  getAllRecords(): StoredDrawingRecord[] {
    return Array.from(this.cache.values());
  }

  async saveMetadata(
    drawingId: string,
    metadataUpdate: Partial<TradeMetadata>,
    positionContext?: {
      positionType?: PositionDrawing["type"];
      prices?: PositionDrawing["prices"];
      entryTime?: number;
      symbol?: string;
    },
  ): Promise<StoredDrawingRecord> {
    const existing = this.cache.get(drawingId);
    const now = Date.now();

    const mergedMetadata: TradeMetadata = {
      type: metadataUpdate.type ?? existing?.metadata.type ?? "",
      breakEntryTime: metadataUpdate.breakEntryTime ?? existing?.metadata.breakEntryTime ?? "",
      notes: metadataUpdate.notes ?? existing?.metadata.notes ?? "",
      updatedAt: now,
    };

    const record: StoredDrawingRecord = {
      drawingId,
      symbol: positionContext?.symbol ?? existing?.symbol,
      positionType: positionContext?.positionType ?? existing?.positionType ?? "long_position",
      prices: positionContext?.prices ?? existing?.prices ?? { entry: 0, stopLoss: 0, takeProfit: 0 },
      entryTime: positionContext?.entryTime ?? existing?.entryTime,
      metadata: mergedMetadata,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.cache.set(drawingId, record);

    const storageKey = METADATA_STORAGE_PREFIX + drawingId;
    await this.storage.set({ [storageKey]: record });

    return record;
  }

  async syncWithDrawings(
    positions: PositionDrawing[],
    symbol?: string,
  ): Promise<PositionWithMetadata[]> {
    await this.init();

    const result: PositionWithMetadata[] = [];
    const updates: Record<string, StoredDrawingRecord> = {};

    for (const pos of positions) {
      let record = this.cache.get(pos.id);

      if (!record) {
        // New drawing: create a fresh record with default empty metadata.
        // This ensures duplicate drawings never share metadata.
        const now = Date.now();
        record = {
          drawingId: pos.id,
          symbol,
          positionType: pos.type,
          prices: pos.prices,
          entryTime: pos.entryTime,
          metadata: defaultTradeMetadata(),
          createdAt: now,
          updatedAt: now,
        };
        this.cache.set(pos.id, record);
        updates[METADATA_STORAGE_PREFIX + pos.id] = record;
      } else {
        // Update price/geometry context in cache if changed
        record.positionType = pos.type;
        record.prices = pos.prices;
        record.entryTime = pos.entryTime;
        if (symbol) record.symbol = symbol;
      }

      result.push({
        ...pos,
        metadata: { ...record.metadata },
      });
    }

    if (Object.keys(updates).length > 0) {
      await this.storage.set(updates);
    }

    return result;
  }

  async cleanupOrphans(activeDrawingIds: string[]): Promise<string[]> {
    await this.init();

    const activeSet = new Set(activeDrawingIds);
    const orphanIds: string[] = [];
    const keysToRemove: string[] = [];

    for (const [id] of this.cache.entries()) {
      if (!activeSet.has(id)) {
        orphanIds.push(id);
        keysToRemove.push(METADATA_STORAGE_PREFIX + id);
      }
    }

    if (keysToRemove.length > 0) {
      for (const id of orphanIds) {
        this.cache.delete(id);
      }
      await this.storage.remove(keysToRemove);
      console.log(
        `[Backtest Assistant: MetadataStore] Cleaned up ${orphanIds.length} orphan records:`,
        orphanIds,
      );
    }

    return orphanIds;
  }

  async deleteRecord(drawingId: string): Promise<boolean> {
    if (!this.cache.has(drawingId)) return false;
    this.cache.delete(drawingId);
    await this.storage.remove(METADATA_STORAGE_PREFIX + drawingId);
    return true;
  }

  async clearAll(): Promise<void> {
    const keysToRemove = Array.from(this.cache.keys()).map(
      (id) => METADATA_STORAGE_PREFIX + id,
    );
    this.cache.clear();
    if (keysToRemove.length > 0) {
      await this.storage.remove(keysToRemove);
    }
  }
}
