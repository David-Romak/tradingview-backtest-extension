console.log(
  "%c[Backtest Assistant] Content script loaded",
  "color: green; font-weight: bold"
);

console.log(
  "[Backtest Assistant] Current URL:",
  window.location.href
);

console.log(
  "[Backtest Assistant] TradingView API:",
  (window as any).TradingViewApi
);