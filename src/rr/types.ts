import type { PositionType } from "../tradingview/types";

export interface RRConfig {
  enabled: boolean;
  defaultRR: number;
}

export interface RRCalculationInput {
  type: PositionType;
  entry: number;
  takeProfit: number;
  targetRR: number;
  symbol?: string;
  tickSize?: number;
}

export interface RRCalculationResult {
  isValid: boolean;
  error?: string;
  calculatedSL: number;
  roundedSL: number;
  risk: number;
  reward: number;
  actualRR: number;
  pipSize: number;
  riskPips: number;
  rewardPips: number;
}

export interface RRPositionState {
  lastEntry: number;
  lastTP: number;
  lastCalculatedSL: number;
}
