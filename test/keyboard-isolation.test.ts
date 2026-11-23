import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { BacktestPanel, sortPositionsNewestFirst } from "../src/content/panel";
import type { PositionWithMetadata } from "../src/metadata/types";

describe("Trade Ordering (Newest Drawing Timestamp on Top)", () => {
  function makePosition(id: string, entryTime: number, updatedAt = 0): PositionWithMetadata {
    return {
      id,
      type: "long_position",
      prices: { entry: 1.085, stopLoss: 1.082, takeProfit: 1.0895 },
      entryTime,
      metadata: {
        type: "",
        breakEntryTime: "",
        notes: "",
        updatedAt,
      },
    };
  }

  it("sorts positions in descending order with newest drawing entryTime on top", () => {
    const p1 = makePosition("oldest_P1", 1700010000);
    const p2 = makePosition("newest_P2", 1700030000);
    const p3 = makePosition("middle_P3", 1700020000);

    const sorted = sortPositionsNewestFirst([p1, p2, p3]);

    assert.strictEqual(sorted[0]?.id, "newest_P2");
    assert.strictEqual(sorted[1]?.id, "middle_P3");
    assert.strictEqual(sorted[2]?.id, "oldest_P1");
  });

  it("falls back to updatedAt when entryTime is identical or missing", () => {
    const p1 = makePosition("older_update", 0, 1000);
    const p2 = makePosition("newer_update", 0, 2000);

    const sorted = sortPositionsNewestFirst([p1, p2]);

    assert.strictEqual(sorted[0]?.id, "newer_update");
    assert.strictEqual(sorted[1]?.id, "older_update");
  });
});

describe("Keyboard Shortcut Isolation", () => {
  let happyWindow: Window;
  let prevWindow: unknown;
  let prevDocument: unknown;

  beforeEach(() => {
    happyWindow = new Window({ url: "https://www.tradingview.com/chart/" });
    prevWindow = globalThis.window;
    prevDocument = globalThis.document;

    // @ts-expect-error happy-dom window shim
    globalThis.window = happyWindow;
    globalThis.document = happyWindow.document;
  });

  afterEach(() => {
    // @ts-expect-error restore original window
    globalThis.window = prevWindow;
    // @ts-expect-error restore original document
    globalThis.document = prevDocument;
  });

  it("isolates keyboard events inside extension inputs from window/document listeners", () => {
    const windowReceivedEvents: KeyboardEvent[] = [];
    const documentReceivedEvents: KeyboardEvent[] = [];

    happyWindow.addEventListener("keydown", (e) => {
      windowReceivedEvents.push(e as KeyboardEvent);
    });
    happyWindow.document.addEventListener("keydown", (e) => {
      documentReceivedEvents.push(e as KeyboardEvent);
    });

    const metadataChanges: Array<{ id: string; update: Record<string, unknown> }> = [];
    const panel = new BacktestPanel({
      onMetadataChange: (id, update) => {
        metadataChanges.push({ id, update });
      },
    });

    panel.mount();

    const samplePositions: PositionWithMetadata[] = [
      {
        id: "P1",
        type: "long_position",
        prices: { entry: 1.085, stopLoss: 1.082, takeProfit: 1.0895 },
        entryTime: 1700000000,
        metadata: { type: "", breakEntryTime: "", notes: "" },
      },
    ];

    panel.setPositions(samplePositions);

    const shadow = panel.getShadowRoot();
    assert.ok(shadow, "Shadow root should be mounted");

    const inputType = shadow.querySelector<HTMLInputElement>(".input-type");
    assert.ok(inputType, "Trade type input must exist");

    // Test a variety of keystrokes: characters, Backspace, Enter, arrow keys, Ctrl+A
    const testKeyEvents = [
      { key: "X", code: "KeyX" },
      { key: "A", code: "KeyA" },
      { key: "U", code: "KeyU" },
      { key: "Backspace", code: "Backspace" },
      { key: "Enter", code: "Enter" },
      { key: "ArrowLeft", code: "ArrowLeft" },
      { key: "ArrowRight", code: "ArrowRight" },
      { key: "a", code: "KeyA", ctrlKey: true }, // Ctrl+A
      { key: "v", code: "KeyV", ctrlKey: true }, // Ctrl+V
    ];

    for (const keyDef of testKeyEvents) {
      const event = new happyWindow.KeyboardEvent("keydown", {
        key: keyDef.key,
        code: keyDef.code,
        ctrlKey: keyDef.ctrlKey ?? false,
        bubbles: true,
        cancelable: true,
      });

      inputType.dispatchEvent(event);

      // Verify that preventDefault was NOT called, preserving native browser editing
      assert.strictEqual(
        event.defaultPrevented,
        false,
        `Key ${keyDef.key} should not have default prevented`,
      );
    }

    // Crucial check: NONE of the keystrokes reached window or document
    assert.strictEqual(
      windowReceivedEvents.length,
      0,
      "TradingView window listener must receive 0 keystrokes from extension inputs",
    );
    assert.strictEqual(
      documentReceivedEvents.length,
      0,
      "TradingView document listener must receive 0 keystrokes from extension inputs",
    );

    // Verify typing still triggers controlled input updates
    inputType.value = "WTB";
    inputType.dispatchEvent(new happyWindow.Event("input", { bubbles: true }));

    assert.strictEqual(metadataChanges.length, 1);
    assert.strictEqual(metadataChanges[0]?.id, "P1");
    assert.strictEqual(metadataChanges[0]?.update.type, "WTB");

    panel.unmount();
  });

  it("allows keyboard events on the chart outside the extension to reach document/window", () => {
    const windowReceivedEvents: KeyboardEvent[] = [];
    happyWindow.addEventListener("keydown", (e) => {
      windowReceivedEvents.push(e as KeyboardEvent);
    });

    const panel = new BacktestPanel({
      onMetadataChange: () => {},
    });
    panel.mount();

    // Create a simulated chart element outside the extension root
    const chartCanvas = happyWindow.document.createElement("div");
    chartCanvas.id = "chart-canvas";
    happyWindow.document.body.appendChild(chartCanvas);

    // Dispatch a keystroke on the chart (e.g. user presses 'E' for symbol search or timeframe)
    const chartEvent = new happyWindow.KeyboardEvent("keydown", {
      key: "E",
      code: "KeyE",
      bubbles: true,
      cancelable: true,
    });
    chartCanvas.dispatchEvent(chartEvent);

    // The chart event MUST reach the window normally
    assert.strictEqual(
      windowReceivedEvents.length,
      1,
      "Keystrokes on chart outside extension must reach window normally",
    );
    assert.strictEqual(windowReceivedEvents[0]?.key, "E");

    panel.unmount();
  });

  it("renders positions ordered with newest timestamp on top in DOM", () => {
    const panel = new BacktestPanel({
      onMetadataChange: () => {},
    });
    panel.mount();

    const positions: PositionWithMetadata[] = [
      {
        id: "pos_older",
        type: "long_position",
        prices: { entry: 1.1, stopLoss: 1.09, takeProfit: 1.115 },
        entryTime: 1600000000,
        metadata: { type: "A0", breakEntryTime: "", notes: "" },
      },
      {
        id: "pos_newest",
        type: "short_position",
        prices: { entry: 1.2, stopLoss: 1.21, takeProfit: 1.185 },
        entryTime: 1800000000, // Newest!
        metadata: { type: "B0", breakEntryTime: "", notes: "" },
      },
      {
        id: "pos_middle",
        type: "long_position",
        prices: { entry: 1.3, stopLoss: 1.29, takeProfit: 1.315 },
        entryTime: 1700000000,
        metadata: { type: "WTB", breakEntryTime: "", notes: "" },
      },
    ];

    panel.setPositions(positions);

    const shadow = panel.getShadowRoot();
    assert.ok(shadow);

    const cards = shadow.querySelectorAll(".card");
    assert.strictEqual(cards.length, 3);

    // Verify DOM card order: newest first!
    assert.strictEqual(cards[0]?.getAttribute("data-drawing-id"), "pos_newest");
    assert.strictEqual(cards[1]?.getAttribute("data-drawing-id"), "pos_middle");
    assert.strictEqual(cards[2]?.getAttribute("data-drawing-id"), "pos_older");

    panel.unmount();
  });

  it("triggers onRequestAnalysis and onExportCSV callbacks on button clicks", () => {
    let analysisRequested = false;
    let exportRequested = false;

    const panel = new BacktestPanel({
      onMetadataChange: () => {},
      onRequestAnalysis: () => {
        analysisRequested = true;
      },
      onExportCSV: () => {
        exportRequested = true;
      },
    });

    panel.mount();
    const shadow = panel.getShadowRoot();
    assert.ok(shadow);

    const btnAnalyze = shadow.querySelector("#btn-analyze") as HTMLButtonElement | null;
    assert.ok(btnAnalyze);
    btnAnalyze.click();
    assert.strictEqual(analysisRequested, true);

    const btnExport = shadow.querySelector("#btn-export-csv") as HTMLButtonElement | null;
    assert.ok(btnExport);
    btnExport.click();
    assert.strictEqual(exportRequested, true);

    panel.unmount();
  });

  it("renders outcome badges, excursion metrics, and footer stats when analysis results are supplied", () => {
    const panel = new BacktestPanel({
      onMetadataChange: () => {},
    });
    panel.mount();

    const positions: PositionWithMetadata[] = [
      {
        id: "p_win",
        type: "long_position",
        prices: { entry: 1.085, stopLoss: 1.08, takeProfit: 1.0925 },
        entryTime: 1700000000,
        metadata: { type: "A0", breakEntryTime: "", notes: "" },
      },
      {
        id: "p_loss",
        type: "short_position",
        prices: { entry: 150.0, stopLoss: 151.0, takeProfit: 148.5 },
        entryTime: 1700003600,
        metadata: { type: "B0", breakEntryTime: "", notes: "" },
      },
    ];

    panel.setPositions(positions);

    panel.setAnalysisResults([
      {
        drawingId: "p_win",
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
      {
        drawingId: "p_loss",
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
        mfePips: 30.0,
        maePips: 100.0,
        ddPips: 30.0, // SL => DD = MFE
      },
    ]);

    const shadow = panel.getShadowRoot();
    assert.ok(shadow);

    // Verify TP badge on winning trade
    const tpBadge = shadow.querySelector('.card[data-drawing-id="p_win"] .badge-tp');
    assert.ok(tpBadge);
    assert.strictEqual(tpBadge.textContent, "TP");

    // Verify SL badge on losing trade
    const slBadge = shadow.querySelector('.card[data-drawing-id="p_loss"] .badge-sl');
    assert.ok(slBadge);
    assert.strictEqual(slBadge.textContent, "SL");

    // Verify metrics chips
    const ddWin = shadow.querySelector('.card[data-drawing-id="p_win"] .metric-chip.dd b');
    assert.strictEqual(ddWin?.textContent, "10p");

    const ddLoss = shadow.querySelector('.card[data-drawing-id="p_loss"] .metric-chip.dd b');
    assert.strictEqual(ddLoss?.textContent, "30p"); // DD = MFE = 30p

    // Verify footer stats
    const footerStats = shadow.querySelector(".footer-stats");
    assert.ok(footerStats);
    assert.ok(footerStats.textContent?.includes("1 TP"));
    assert.ok(footerStats.textContent?.includes("1 SL"));

    panel.unmount();
  });
});
