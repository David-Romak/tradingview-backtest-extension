import type { RRCalculationInput, RRCalculationResult } from "./types";

export function getPipSize(symbol?: string, samplePrice?: number): number {
  const sym = symbol ? symbol.toUpperCase() : "";

  if (sym.includes("XAU") || sym.includes("GOLD")) {
    return 0.1;
  }
  if (sym.includes("XAG") || sym.includes("SILVER")) {
    return 0.01;
  }
  if (sym.includes("JPY")) {
    return 0.01;
  }

  // Price heuristic if symbol is unknown: JPY pairs trade around 50-300
  if (!symbol && typeof samplePrice === "number" && samplePrice > 40 && samplePrice < 300) {
    return 0.01;
  }

  // Standard non-JPY Forex pair (e.g. EURUSD, GBPUSD)
  return 0.0001;
}

export function getTickSize(symbol?: string, samplePrice?: number): number {
  const sym = symbol ? symbol.toUpperCase() : "";

  if (sym.includes("XAU") || sym.includes("GOLD")) {
    return 0.01;
  }
  if (sym.includes("XAG") || sym.includes("SILVER")) {
    return 0.001;
  }
  if (sym.includes("JPY")) {
    return 0.001; // Standard 3-decimal quote for JPY (fractional pip)
  }

  // Standard Forex pairs have 5 decimal places (fractional pip / pipette)
  if (sym && sym.length >= 6) {
    return 0.00001;
  }

  // Heuristic if symbol is not explicitly specified
  let tick = 0.00001;

  if (typeof samplePrice === "number" && Number.isFinite(samplePrice)) {
    const str = samplePrice.toString();
    const dotIndex = str.indexOf(".");
    if (dotIndex !== -1) {
      const decimals = str.length - dotIndex - 1;
      if (decimals >= 5) {
        tick = 0.00001;
      } else if (decimals > 0) {
        tick = Number((1 / Math.pow(10, decimals)).toFixed(decimals));
      }
    }
  }

  return tick;
}

export function roundToTick(price: number, tickSize: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) {
    return price;
  }

  const decimals = Math.max(0, Math.min(8, Math.round(-Math.log10(tickSize))));
  const rounded = Math.round(price / tickSize) * tickSize;
  return Number(rounded.toFixed(decimals));
}

export function calculateStopLoss(input: RRCalculationInput): RRCalculationResult {
  const { type, entry, takeProfit, targetRR, symbol } = input;

  const pipSize = getPipSize(symbol, entry);
  const tickSize = input.tickSize ?? getTickSize(symbol, entry);

  if (!Number.isFinite(entry) || !Number.isFinite(takeProfit)) {
    return {
      isValid: false,
      error: "Entry and Take-Profit prices must be finite numbers",
      calculatedSL: 0,
      roundedSL: 0,
      risk: 0,
      reward: 0,
      actualRR: 0,
      pipSize,
      riskPips: 0,
      rewardPips: 0,
    };
  }

  if (!Number.isFinite(targetRR) || targetRR <= 0) {
    return {
      isValid: false,
      error: "Target RR must be a positive number greater than 0",
      calculatedSL: 0,
      roundedSL: 0,
      risk: 0,
      reward: 0,
      actualRR: 0,
      pipSize,
      riskPips: 0,
      rewardPips: 0,
    };
  }

  let calculatedSL: number;

  if (type === "long_position") {
    // For BUY: TP must be strictly greater than Entry
    if (takeProfit <= entry) {
      return {
        isValid: false,
        error: "Take-Profit must be strictly above Entry price for a BUY (Long) position",
        calculatedSL: 0,
        roundedSL: 0,
        risk: 0,
        reward: 0,
        actualRR: 0,
        pipSize,
        riskPips: 0,
        rewardPips: 0,
      };
    }

    // Formula: SL = Entry - (TP - Entry) / RR
    calculatedSL = entry - (takeProfit - entry) / targetRR;
  } else if (type === "short_position") {
    // For SELL: TP must be strictly less than Entry
    if (takeProfit >= entry) {
      return {
        isValid: false,
        error: "Take-Profit must be strictly below Entry price for a SELL (Short) position",
        calculatedSL: 0,
        roundedSL: 0,
        risk: 0,
        reward: 0,
        actualRR: 0,
        pipSize,
        riskPips: 0,
        rewardPips: 0,
      };
    }

    // Formula: SL = Entry + (Entry - TP) / RR
    calculatedSL = entry + (entry - takeProfit) / targetRR;
  } else {
    return {
      isValid: false,
      error: `Unsupported position type: ${String(type)}`,
      calculatedSL: 0,
      roundedSL: 0,
      risk: 0,
      reward: 0,
      actualRR: 0,
      pipSize,
      riskPips: 0,
      rewardPips: 0,
    };
  }

  const roundedSL = roundToTick(calculatedSL, tickSize);
  const risk = Math.abs(entry - roundedSL);
  const reward = Math.abs(takeProfit - entry);

  // Compute actual RR after tick rounding
  const actualRR = risk > 0 ? Number((reward / risk).toFixed(4)) : 0;
  const riskPips = Number((risk / pipSize).toFixed(1));
  const rewardPips = Number((reward / pipSize).toFixed(1));

  return {
    isValid: true,
    calculatedSL,
    roundedSL,
    risk,
    reward,
    actualRR,
    pipSize,
    riskPips,
    rewardPips,
  };
}
