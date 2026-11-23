import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateStopLoss,
  getPipSize,
  getTickSize,
  roundToTick,
} from "../src/rr/calculator";
import { RRManager } from "../src/rr/manager";
import type { PositionDrawing } from "../src/tradingview/types";

describe("RR Calculator", () => {
  describe("Pip & Tick Sizing", () => {
    it("returns standard Forex pip sizes", () => {
      assert.strictEqual(getPipSize("EURUSD"), 0.0001);
      assert.strictEqual(getPipSize("GBPUSD"), 0.0001);
      assert.strictEqual(getPipSize("USDJPY"), 0.01);
      assert.strictEqual(getPipSize("EURJPY"), 0.01);
      assert.strictEqual(getPipSize("XAUUSD"), 0.1);
    });

    it("returns standard tick sizes and fractional pip precision", () => {
      assert.strictEqual(getTickSize("EURUSD", 1.08542), 0.00001);
      assert.strictEqual(getTickSize("USDJPY", 152.352), 0.001);
      assert.strictEqual(getTickSize("XAUUSD", 2650.50), 0.01);
    });

    it("rounds prices correctly to specified tick sizes", () => {
      assert.strictEqual(roundToTick(1.085023, 0.00001), 1.08502);
      assert.strictEqual(roundToTick(152.3456, 0.001), 152.346);
      assert.strictEqual(roundToTick(2650.555, 0.01), 2650.56);
    });
  });

  describe("BUY (long_position) Stop-Loss Formula", () => {
    it("calculates SL accurately for EURUSD with 1.5 RR", () => {
      // Entry: 1.08500, TP: 1.08950 (45 pips reward)
      // Risk needed: 45 / 1.5 = 30 pips -> SL = 1.08500 - 0.00300 = 1.08200
      const result = calculateStopLoss({
        type: "long_position",
        entry: 1.08500,
        takeProfit: 1.08950,
        targetRR: 1.5,
        symbol: "EURUSD",
      });

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.roundedSL, 1.08200);
      assert.strictEqual(result.actualRR, 1.5);
      assert.strictEqual(result.riskPips, 30.0);
      assert.strictEqual(result.rewardPips, 45.0);
    });

    it("rejects invalid BUY position where TP <= Entry", () => {
      const result = calculateStopLoss({
        type: "long_position",
        entry: 1.08500,
        takeProfit: 1.08200, // Below entry!
        targetRR: 1.5,
        symbol: "EURUSD",
      });

      assert.strictEqual(result.isValid, false);
      assert.match(result.error ?? "", /strictly above Entry/);
    });
  });

  describe("SELL (short_position) Stop-Loss Formula", () => {
    it("calculates SL accurately for EURUSD with 1.5 RR", () => {
      // Entry: 1.09200, TP: 1.08750 (45 pips reward)
      // Risk needed: 45 / 1.5 = 30 pips -> SL = 1.09200 + 0.00300 = 1.09500
      const result = calculateStopLoss({
        type: "short_position",
        entry: 1.09200,
        takeProfit: 1.08750,
        targetRR: 1.5,
        symbol: "EURUSD",
      });

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.roundedSL, 1.09500);
      assert.strictEqual(result.actualRR, 1.5);
      assert.strictEqual(result.riskPips, 30.0);
      assert.strictEqual(result.rewardPips, 45.0);
    });

    it("calculates SL accurately for USDJPY pair with 1.5 RR", () => {
      // Entry: 152.000, TP: 150.500 (150 pips reward)
      // Risk needed: 150 / 1.5 = 100 pips -> SL = 152.000 + 1.000 = 153.000
      const result = calculateStopLoss({
        type: "short_position",
        entry: 152.000,
        takeProfit: 150.500,
        targetRR: 1.5,
        symbol: "USDJPY",
      });

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.roundedSL, 153.000);
      assert.strictEqual(result.actualRR, 1.5);
      assert.strictEqual(result.riskPips, 100.0);
      assert.strictEqual(result.rewardPips, 150.0);
    });

    it("rejects invalid SELL position where TP >= Entry", () => {
      const result = calculateStopLoss({
        type: "short_position",
        entry: 1.09200,
        takeProfit: 1.09500, // Above entry!
        targetRR: 1.5,
        symbol: "EURUSD",
      });

      assert.strictEqual(result.isValid, false);
      assert.match(result.error ?? "", /strictly below Entry/);
    });

    it("computes actual RR truthfully after tick rounding", () => {
      // Non-exact tick scenario:
      // Entry: 1.08500, TP: 1.08947 (44.7 pips reward), RR: 1.5
      // Raw SL: 1.08500 - (0.00447 / 1.5) = 1.08500 - 0.00298 = 1.08202
      const result = calculateStopLoss({
        type: "long_position",
        entry: 1.08500,
        takeProfit: 1.08947,
        targetRR: 1.5,
        symbol: "EURUSD",
      });

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.roundedSL, 1.08202);
      assert.strictEqual(result.actualRR, 1.5);
    });
  });
});

describe("RRManager Automation & State Tracking", () => {
  function makeDrawing(params: {
    id: string;
    type: "long_position" | "short_position";
    entry: number;
    stopLoss: number;
    takeProfit: number;
  }): PositionDrawing {
    return {
      id: params.id,
      type: params.type,
      prices: {
        entry: params.entry,
        stopLoss: params.stopLoss,
        takeProfit: params.takeProfit,
      },
      entryTime: 1700000000,
    };
  }

  it("applies Stop-Loss on new position drawing", () => {
    const slUpdates: Array<{ id: string; sl: number }> = [];

    const manager = new RRManager({
      onApplyStopLoss: (id, sl) => {
        slUpdates.push({ id, sl });
      },
    });

    const pos = makeDrawing({
      id: "P1",
      type: "long_position",
      entry: 1.08500,
      stopLoss: 1.08000, // Initial unadjusted SL
      takeProfit: 1.08950,
    });

    manager.processPositions([pos], "EURUSD");

    assert.strictEqual(slUpdates.length, 1);
    assert.strictEqual(slUpdates[0]?.id, "P1");
    assert.strictEqual(slUpdates[0]?.sl, 1.08200);
  });

  it("prevents recursive feedback loop when the applied SL is confirmed in next snapshot", () => {
    const slUpdates: Array<{ id: string; sl: number }> = [];

    const manager = new RRManager({
      onApplyStopLoss: (id, sl) => {
        slUpdates.push({ id, sl });
      },
    });

    // Step 1: Initial position with unadjusted SL
    const pos1 = makeDrawing({
      id: "P1",
      type: "long_position",
      entry: 1.08500,
      stopLoss: 1.08000,
      takeProfit: 1.08950,
    });
    manager.processPositions([pos1], "EURUSD");
    assert.strictEqual(slUpdates.length, 1);

    // Step 2: Next snapshot arrives with the updated SL (1.08200) applied by TradingView
    const pos2 = makeDrawing({
      id: "P1",
      type: "long_position",
      entry: 1.08500,
      stopLoss: 1.08200, // Updated SL matches our target!
      takeProfit: 1.08950,
    });
    manager.processPositions([pos2], "EURUSD");

    // CRITICAL: Must NOT trigger another update!
    assert.strictEqual(slUpdates.length, 1, "Must not trigger repeated SL updates");
  });

  it("recalculates Stop-Loss when Entry or TP changes", () => {
    const slUpdates: Array<{ id: string; sl: number }> = [];

    const manager = new RRManager({
      onApplyStopLoss: (id, sl) => {
        slUpdates.push({ id, sl });
      },
    });

    // Initial state
    const pos1 = makeDrawing({
      id: "P1",
      type: "long_position",
      entry: 1.08500,
      stopLoss: 1.08200,
      takeProfit: 1.08950,
    });
    manager.processPositions([pos1], "EURUSD");
    assert.strictEqual(slUpdates.length, 0); // Already at 1.5 RR

    // User drags TP higher to 1.09100 (+60 pips reward -> need 40 pips risk -> SL = 1.08100)
    const pos2 = makeDrawing({
      id: "P1",
      type: "long_position",
      entry: 1.08500,
      stopLoss: 1.08200,
      takeProfit: 1.09100,
    });
    manager.processPositions([pos2], "EURUSD");

    assert.strictEqual(slUpdates.length, 1);
    assert.strictEqual(slUpdates[0]?.sl, 1.08100);
  });

  it("does not adjust Stop-Loss when automation is disabled", () => {
    const slUpdates: Array<{ id: string; sl: number }> = [];

    const manager = new RRManager(
      {
        onApplyStopLoss: (id, sl) => {
          slUpdates.push({ id, sl });
        },
      },
      { enabled: false },
    );

    const pos = makeDrawing({
      id: "P1",
      type: "long_position",
      entry: 1.08500,
      stopLoss: 1.08000,
      takeProfit: 1.08950,
    });

    manager.processPositions([pos], "EURUSD");
    assert.strictEqual(slUpdates.length, 0);
  });

  it("recalculates positions when user changes target RR setting", () => {
    const slUpdates: Array<{ id: string; sl: number }> = [];

    const manager = new RRManager({
      onApplyStopLoss: (id, sl) => {
        slUpdates.push({ id, sl });
      },
    });

    const pos = makeDrawing({
      id: "P1",
      type: "long_position",
      entry: 1.08500,
      stopLoss: 1.08200, // Current SL is for 1.5 RR
      takeProfit: 1.08950,
    });

    manager.processPositions([pos], "EURUSD");
    assert.strictEqual(slUpdates.length, 0); // Already 1.5 RR

    // User changes target RR from 1.5 to 2.0
    // Reward = 45 pips -> Risk for 2.0 RR = 45 / 2 = 22.5 pips -> SL = 1.08500 - 0.00225 = 1.08275
    manager.setConfig({ defaultRR: 2.0 }, [pos], "EURUSD");

    assert.strictEqual(slUpdates.length, 1);
    assert.strictEqual(slUpdates[0]?.sl, 1.08275);
  });
});
