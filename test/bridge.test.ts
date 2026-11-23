import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BRIDGE_CHANNEL, BRIDGE_MESSAGE_TYPES } from "../src/shared/constants";
import type { DrawingsUpdatedMessage, SetStopLossMessage } from "../src/tradingview/types";

describe("Messaging Bridge", () => {
  it("creates and validates DRAWINGS_UPDATED message format", () => {
    const payload = {
      totalDrawings: 5,
      positions: [
        {
          id: "HnuPOQ",
          type: "long_position" as const,
          prices: { entry: 1.085, stopLoss: 1.082, takeProfit: 1.0895 },
          entryTime: 1700000000,
        },
      ],
      timestamp: Date.now(),
    };

    const message: DrawingsUpdatedMessage = {
      channel: BRIDGE_CHANNEL,
      type: BRIDGE_MESSAGE_TYPES.DRAWINGS_UPDATED,
      payload,
    };

    assert.strictEqual(message.channel, "BACKTEST_ASSISTANT_BRIDGE");
    assert.strictEqual(message.type, "DRAWINGS_UPDATED");
    assert.strictEqual(message.payload.positions.length, 1);
    assert.strictEqual(message.payload.positions[0]?.id, "HnuPOQ");
    assert.strictEqual(message.payload.positions[0]?.prices.entry, 1.085);
  });

  it("creates and validates SET_STOP_LOSS message format", () => {
    const message: SetStopLossMessage = {
      channel: BRIDGE_CHANNEL,
      type: BRIDGE_MESSAGE_TYPES.SET_STOP_LOSS,
      payload: {
        drawingId: "HnuPOQ",
        stopLoss: 1.083,
      },
    };

    assert.strictEqual(message.channel, "BACKTEST_ASSISTANT_BRIDGE");
    assert.strictEqual(message.type, "SET_STOP_LOSS");
    assert.strictEqual(message.payload.drawingId, "HnuPOQ");
    assert.strictEqual(message.payload.stopLoss, 1.083);
  });
});
