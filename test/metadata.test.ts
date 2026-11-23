import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InMemoryStorageAdapter, MetadataStore } from "../src/metadata/store";
import type { PositionDrawing } from "../src/tradingview/types";

describe("MetadataStore", () => {
  function makePosition(id: string, type: "long_position" | "short_position" = "long_position"): PositionDrawing {
    return {
      id,
      type,
      prices: { entry: 1.085, stopLoss: 1.082, takeProfit: 1.0895 },
      entryTime: 1700000000,
    };
  }

  it("returns default empty metadata for newly discovered drawings", () => {
    const store = new MetadataStore(new InMemoryStorageAdapter());
    const meta = store.getMetadata("unseen_id");

    assert.strictEqual(meta.type, "");
    assert.strictEqual(meta.breakEntryTime, "");
    assert.strictEqual(meta.notes, "");
  });

  it("saves and retrieves metadata associated with a drawing ID", async () => {
    const storage = new InMemoryStorageAdapter();
    const store = new MetadataStore(storage);

    await store.saveMetadata("pos_1", {
      type: "A0",
      breakEntryTime: "08:30 - 09:15",
      notes: "Clean breakout retest",
    });

    const retrieved = store.getMetadata("pos_1");
    assert.strictEqual(retrieved.type, "A0");
    assert.strictEqual(retrieved.breakEntryTime, "08:30 - 09:15");
    assert.strictEqual(retrieved.notes, "Clean breakout retest");
  });

  it("survives page reloads / re-instantiation from storage", async () => {
    const sharedStorage = new InMemoryStorageAdapter();

    // First session: save metadata
    const session1 = new MetadataStore(sharedStorage);
    await session1.saveMetadata("pos_1", {
      type: "WTB",
      breakEntryTime: "10:00 - 10:30",
      notes: "Inside breakout",
    });

    // Second session: simulate page reload
    const session2 = new MetadataStore(sharedStorage);
    await session2.init();

    const retrieved = session2.getMetadata("pos_1");
    assert.strictEqual(retrieved.type, "WTB");
    assert.strictEqual(retrieved.breakEntryTime, "10:00 - 10:30");
    assert.strictEqual(retrieved.notes, "Inside breakout");
  });

  it("ensures duplicate drawings do not accidentally share metadata", async () => {
    const store = new MetadataStore(new InMemoryStorageAdapter());

    // Original drawing has metadata
    await store.saveMetadata("original_draw_1", {
      type: "A0",
      notes: "Original setup",
    });

    // Duplicated drawing gets a new unique ID in TradingView
    const synced = await store.syncWithDrawings([
      makePosition("original_draw_1"),
      makePosition("duplicated_draw_2"),
    ]);

    const originalMeta = synced.find((p) => p.id === "original_draw_1")?.metadata;
    const duplicatedMeta = synced.find((p) => p.id === "duplicated_draw_2")?.metadata;

    assert.strictEqual(originalMeta?.type, "A0");
    assert.strictEqual(originalMeta?.notes, "Original setup");

    // Duplicated drawing must have fresh empty metadata
    assert.strictEqual(duplicatedMeta?.type, "");
    assert.strictEqual(duplicatedMeta?.notes, "");
  });

  it("cleans up orphan records when drawings are deleted from chart", async () => {
    const storage = new InMemoryStorageAdapter();
    const store = new MetadataStore(storage);

    // Save metadata for 3 drawings
    await store.saveMetadata("draw_1", { type: "A0" });
    await store.saveMetadata("draw_2", { type: "B0" });
    await store.saveMetadata("draw_3", { type: "ETE" });

    assert.strictEqual(store.getAllRecords().length, 3);

    // Drawing 2 was deleted from chart, only 1 and 3 are active
    const activeDrawingIds = ["draw_1", "draw_3"];
    const cleaned = await store.cleanupOrphans(activeDrawingIds);

    assert.deepStrictEqual(cleaned, ["draw_2"]);
    assert.strictEqual(store.getAllRecords().length, 2);
    assert.strictEqual(store.getRecord("draw_2"), null);
    assert.strictEqual(store.getRecord("draw_1")?.metadata.type, "A0");
    assert.strictEqual(store.getRecord("draw_3")?.metadata.type, "ETE");
  });

  it("syncWithDrawings preserves existing metadata and records symbol context", async () => {
    const store = new MetadataStore(new InMemoryStorageAdapter());

    await store.saveMetadata("draw_1", {
      type: "B0(AWAY)",
      notes: "Pre-existing note",
    });

    const positions: PositionDrawing[] = [
      makePosition("draw_1"),
      makePosition("draw_new"),
    ];

    const result = await store.syncWithDrawings(positions, "FX:EURUSD");

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]?.metadata.type, "B0(AWAY)");
    assert.strictEqual(result[0]?.metadata.notes, "Pre-existing note");
    assert.strictEqual(result[1]?.metadata.type, "");

    const record1 = store.getRecord("draw_1");
    assert.strictEqual(record1?.symbol, "FX:EURUSD");
  });
});
