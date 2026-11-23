console.log(
  "%c[Backtest Assistant: Page Bridge] Loaded",
  "color: blue; font-weight: bold",
);

const tradingViewApi = (window as any).TradingViewApi;

console.log(
  "[Backtest Assistant: Page Bridge] TradingView API:",
  tradingViewApi,
);

console.log(
  "[Backtest Assistant: Page Bridge] Active chart:",
  tradingViewApi?.activeChart?.(),
);
