import { getPipSize } from "../rr/calculator";
import type {
  CandleBar,
  TradeAnalysisInput,
  TradeAnalysisResult,
  TradeOutcome,
} from "./types";

export function formatDateTime(timestampInSeconds?: number): string {
  if (!timestampInSeconds || !Number.isFinite(timestampInSeconds)) {
    return "";
  }
  const date = new Date(timestampInSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function formatDateOnly(timestampInSeconds?: number): string {
  if (!timestampInSeconds || !Number.isFinite(timestampInSeconds)) {
    return "";
  }
  const date = new Date(timestampInSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());

  return `${year}-${month}-${day}`;
}

export function analyzeTrade(input: TradeAnalysisInput): TradeAnalysisResult {
  const {
    drawingId,
    type,
    entry,
    stopLoss,
    takeProfit,
    entryTime,
    symbol,
    candles,
  } = input;

  const bias: "buy" | "sell" = type === "long_position" ? "buy" : "sell";
  const pipSize = input.pipSize ?? getPipSize(symbol, entry);

  const tpDistance = Math.abs(takeProfit - entry);
  const slDistance = Math.abs(entry - stopLoss);

  const tpPips = Number((tpDistance / pipSize).toFixed(1));
  const slPips = Number((slDistance / pipSize).toFixed(1));
  const actualRR = slDistance > 0 ? Number((tpDistance / slDistance).toFixed(4)) : 0;

  const normEntryTime =
    typeof entryTime === "number" && entryTime > 1e11
      ? Math.floor(entryTime / 1000)
      : (entryTime ?? 0);

  const entryDateStr = formatDateTime(normEntryTime);

  // Normalize all candles to seconds and sort chronologically
  const normCandles: CandleBar[] = candles
    .map((c) => ({
      ...c,
      time: c.time > 1e11 ? Math.floor(c.time / 1000) : c.time,
    }))
    .sort((a, b) => a.time - b.time);

  if (normCandles.length === 0) {
    return {
      drawingId,
      bias,
      entryPrice: entry,
      stopLossPrice: stopLoss,
      takeProfitPrice: takeProfit,
      entryTime: normEntryTime,
      entryDateStr,
      result: "OPEN",
      tpPips,
      slPips,
      actualRR,
      mfePips: 0,
      maePips: 0,
      ddPips: 0,
      notes: "No candle data found on chart (ensure chart is loaded)",
    };
  }

  // Determine post-entry candles:
  // In financial charts, bar.time is the OPEN timestamp of the bar.
  // A drawing placed on bar i might have an entryTime between bar[i].time and bar[i+1].time.
  // Or if placed on the latest bar, entryTime >= lastBar.time.
  let postEntryCandles: CandleBar[] = [];

  if (normEntryTime <= 0) {
    postEntryCandles = normCandles;
  } else {
    let entryIndex = -1;
    for (let i = normCandles.length - 1; i >= 0; i--) {
      if (normCandles[i].time <= normEntryTime) {
        entryIndex = i;
        break;
      }
    }

    if (entryIndex >= 0) {
      // If entryIndex is the very last candle, check if entryTime is reasonably close
      // to that candle's timeframe interval rather than far into the un-loaded future.
      const lastCandle = normCandles[normCandles.length - 1];
      if (entryIndex === normCandles.length - 1 && normCandles.length >= 2) {
        const interval =
          normCandles[normCandles.length - 1].time -
          normCandles[normCandles.length - 2].time;
        // If entryTime is more than 3 intervals after the last candle, the data is truly missing
        if (interval > 0 && normEntryTime > lastCandle.time + interval * 3) {
          entryIndex = -1;
        }
      } else if (entryIndex === normCandles.length - 1 && normCandles.length === 1) {
        if (normEntryTime > lastCandle.time + 3600) {
          entryIndex = -1;
        }
      }

      if (entryIndex >= 0) {
        postEntryCandles = normCandles.slice(entryIndex);
      }
    } else {
      // entryTime is before all loaded candles: start from the first candle
      postEntryCandles = normCandles;
    }
  }

  if (postEntryCandles.length === 0) {
    return {
      drawingId,
      bias,
      entryPrice: entry,
      stopLossPrice: stopLoss,
      takeProfitPrice: takeProfit,
      entryTime: normEntryTime,
      entryDateStr,
      result: "OPEN",
      tpPips,
      slPips,
      actualRR,
      mfePips: 0,
      maePips: 0,
      ddPips: 0,
      notes: "No candle data available after entry time",
    };
  }

  let maxFavorableDiff = 0;
  let maxAdverseDiff = 0;
  let outcome: TradeOutcome = "OPEN";
  let outcomeTime: number | undefined = undefined;
  let notes: string | undefined = undefined;

  for (const bar of postEntryCandles) {
    if (bias === "buy") {
      const touchedTP = bar.high >= takeProfit;
      const touchedSL = bar.low <= stopLoss;

      if (touchedTP && touchedSL) {
        // Both hit in the same bar - ambiguous sequence
        outcome = "AMBIGUOUS";
        outcomeTime = bar.time;
        maxFavorableDiff = Math.max(maxFavorableDiff, takeProfit - entry);
        maxAdverseDiff = Math.max(maxAdverseDiff, entry - stopLoss);
        notes = `Ambiguous outcome: single candle touched both TP (${takeProfit}) and SL (${stopLoss}) at ${formatDateTime(bar.time)}`;
        break;
      }

      if (touchedTP) {
        outcome = "TP";
        outcomeTime = bar.time;
        maxFavorableDiff = Math.max(maxFavorableDiff, takeProfit - entry);
        maxAdverseDiff = Math.max(maxAdverseDiff, Math.max(0, entry - bar.low));
        break;
      }

      if (touchedSL) {
        outcome = "SL";
        outcomeTime = bar.time;
        maxAdverseDiff = Math.max(maxAdverseDiff, entry - stopLoss);
        maxFavorableDiff = Math.max(maxFavorableDiff, Math.max(0, bar.high - entry));
        break;
      }

      // Neither touched: accumulate excursions while trade is running
      maxFavorableDiff = Math.max(maxFavorableDiff, Math.max(0, bar.high - entry));
      maxAdverseDiff = Math.max(maxAdverseDiff, Math.max(0, entry - bar.low));
    } else {
      // bias === "sell"
      const touchedTP = bar.low <= takeProfit;
      const touchedSL = bar.high >= stopLoss;

      if (touchedTP && touchedSL) {
        // Both hit in the same bar - ambiguous sequence
        outcome = "AMBIGUOUS";
        outcomeTime = bar.time;
        maxFavorableDiff = Math.max(maxFavorableDiff, entry - takeProfit);
        maxAdverseDiff = Math.max(maxAdverseDiff, stopLoss - entry);
        notes = `Ambiguous outcome: single candle touched both TP (${takeProfit}) and SL (${stopLoss}) at ${formatDateTime(bar.time)}`;
        break;
      }

      if (touchedTP) {
        outcome = "TP";
        outcomeTime = bar.time;
        maxFavorableDiff = Math.max(maxFavorableDiff, entry - takeProfit);
        maxAdverseDiff = Math.max(maxAdverseDiff, Math.max(0, bar.high - entry));
        break;
      }

      if (touchedSL) {
        outcome = "SL";
        outcomeTime = bar.time;
        maxAdverseDiff = Math.max(maxAdverseDiff, stopLoss - entry);
        maxFavorableDiff = Math.max(maxFavorableDiff, Math.max(0, entry - bar.low));
        break;
      }

      // Neither touched: accumulate excursions while trade is running
      maxFavorableDiff = Math.max(maxFavorableDiff, Math.max(0, entry - bar.low));
      maxAdverseDiff = Math.max(maxAdverseDiff, Math.max(0, bar.high - entry));
    }
  }

  const mfePips = Number((maxFavorableDiff / pipSize).toFixed(1));
  const maePips = Number((maxAdverseDiff / pipSize).toFixed(1));

  // User DD Convention:
  // - If trade ends in SL, DD = MFE
  // - If trade ends in TP, DD = MAE
  // - If trade is still OPEN or AMBIGUOUS, DD = MAE
  let ddPips: number;
  if (outcome === "SL") {
    ddPips = mfePips;
  } else if (outcome === "TP") {
    ddPips = maePips;
  } else {
    ddPips = maePips;
  }

  return {
    drawingId,
    bias,
    entryPrice: entry,
    stopLossPrice: stopLoss,
    takeProfitPrice: takeProfit,
    entryTime: normEntryTime,
    entryDateStr,
    result: outcome,
    outcomeTime,
    outcomeDateStr: outcomeTime ? formatDateTime(outcomeTime) : undefined,
    tpPips,
    slPips,
    actualRR,
    mfePips,
    maePips,
    ddPips,
    notes,
  };
}
