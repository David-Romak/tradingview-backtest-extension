# TradingView Backtest Assistant

A Chrome extension that makes manual Forex backtesting on TradingView more structured, consistent, and measurable.

TradingView already provides native Long Position and Short Position drawings for marking trades on historical charts. This extension builds on those drawings by connecting them to trade metadata, enforcing configurable risk-to-reward rules, and extracting performance metrics for deeper analysis.

Instead of manually maintaining a separate spreadsheet while backtesting, you can manage trade information directly alongside the drawings on your chart.

## Features

### Native TradingView Drawing Integration

- Detects native Long Position and Short Position drawings.
- Extracts drawing identifiers, entry prices, stop-loss prices, take-profit prices, and entry timestamps.
- Tracks drawing changes as they happen.
- Supports multiple position drawings on the same chart.
- Uses drawing IDs to maintain a reliable association between chart drawings and their metadata.

### Synchronized Trade Selection

- Selecting a position drawing on TradingView automatically selects its corresponding trade in the extension.
- Selecting a trade in the extension selects its corresponding drawing on the chart.
- Switching between drawings automatically loads the associated metadata.
- Keeps the chart and metadata form synchronized, eliminating the need to search for individual trades manually.

### Trade Metadata

Attach additional information to individual trades:

- **Type:** Classify trades according to your own setup categories.
- **Breakout / Entry Time:** Record the breakout time and actual entry time.
- **Notes:** Capture observations, reasoning, and other relevant details.

Metadata is associated with the specific drawing rather than its position in a list.

### Risk-to-Reward Management

Maintain consistent risk-to-reward relationships while working with position drawings.

- Configurable risk-to-reward ratio.
- Default ratio of 1:1.5.
- Automatically calculates the stop-loss level based on entry and take-profit prices.
- Handles both Long and Short positions.
- Accounts for the direction of the trade when calculating stop-loss prices.

### Historical Trade Analysis

Analyze the historical price movement after each trade's entry.

The extension calculates:

| Metric | Description |
|---|---|
| Result | Whether the trade reached Take Profit or Stop Loss first |
| AT | Time at which the outcome level was reached |
| MFE | Maximum Favorable Excursion |
| MAE | Maximum Adverse Excursion |
| DD | Drawdown metric derived from MFE or MAE, according to the result |
| RR | Actual risk-to-reward ratio |
| TP | Take-profit distance in pips |
| SL | Stop-loss distance in pips |

When historical candle data cannot establish whether TP or SL was reached first, the result should be treated as ambiguous rather than assuming an outcome.

### Trade Export

Export analyzed trades for further review, reporting, spreadsheet analysis, or AI-assisted strategy evaluation.

The exported data includes trade classification, timing, direction, entry, TP, SL, result, performance metrics, risk-to-reward ratio, and notes.

## Architecture

The extension uses a two-world architecture to communicate with TradingView while keeping extension functionality isolated.

```text
                  TradingView
                       |
                       |
                TradingView API
                       |
                       v
              +------------------+
              |    MAIN World    |
              |                  |
              |  Page Bridge     |
              |  Drawing Access  |
              |  Selection Sync  |
              +------------------+
                       |
                       | Message Bridge
                       |
                       v
              +------------------+
              |  ISOLATED World  |
              |                  |
              |  Extension UI    |
              |  Metadata Form   |
              |  State Management|
              |  Export          |
              +------------------+
                       |
                       v
              Chrome Extension
                   Storage
```

**Why two worlds?**

Chrome content scripts normally execute in an isolated JavaScript environment. TradingView's internal chart APIs are not directly accessible from that environment.

The MAIN-world page bridge handles communication with TradingView's chart internals. The ISOLATED-world content script manages the extension's functionality and communicates with the page bridge through validated messages.

This separation allows the extension to interact with TradingView without placing its entire application inside the page's JavaScript environment.

## Technology Stack

- TypeScript
- Chrome Extensions Manifest V3
- JavaScript / Browser APIs
- esbuild
- Chrome Storage API
- TradingView chart internals

## Getting Started

### Prerequisites

- Google Chrome or a Chromium-based browser.
- Node.js and npm.
- Access to TradingView.

### Installation

Clone the repository:

```bash
git clone <repository-url>
cd tradingview-backtest-extension
```

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

### Load the Extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the extension's project directory.
5. Open TradingView and load a chart.
6. Start working with your position drawings.

After making code changes, rebuild the extension and reload it from the Chrome extensions page.

## Development

### Available Commands

```bash
# Build the extension
npm run build

# Run automated tests
npm test

# Run TypeScript type checking
npm run typecheck

# Watch for changes during development
npm run watch
```

### Project Structure

```text
tradingview-backtest-extension/
├── src/
│   ├── content/
│   │   └── index.ts
│   ├── tradingview/
│   │   ├── adapter.ts
│   │   ├── drawings.ts
│   │   ├── page-bridge.ts
│   │   └── types.ts
│   ├── metadata/
│   │   ├── store.ts
│   │   └── types.ts
│   └── shared/
│       └── constants.ts
├── test/
├── dist/
├── manifest.json
├── package.json
└── tsconfig.json
```

*The structure above describes the main application modules; additional files may exist as development continues.*

## Design Principles

- **Drawing identity matters:** Metadata belongs to a specific drawing ID, not a list position.
- **Separation of concerns:** TradingView integration, metadata management, and analysis are kept distinct.
- **Accuracy over assumptions:** Historical results should not be fabricated when candle data is insufficient.
- **Minimal interference:** The extension should preserve TradingView's normal chart functionality outside its own interface.
- **Testable logic:** Financial calculations and integration behavior should be verified independently wherever possible.

## Scope

This project is designed for manual Forex backtesting using TradingView's native Long Position and Short Position drawings.

It is not intended to be an automated trading bot, broker integration, or live trade execution system.

TradingView's internal APIs are not a stable public extension interface, so changes to TradingView may require updates to the integration layer.

## Roadmap

Potential future improvements:

- More detailed strategy performance reports.
- Win-rate and expectancy calculations.
- Session-based and setup-based performance breakdowns.
- Equity curves and cumulative performance analysis.
- Advanced filtering and comparison of trade setups.
- More flexible export formats.

## Contributing

Contributions, bug reports, and suggestions are welcome.

If you encounter a problem, please include:
- A description of the issue.
- Steps to reproduce it.
- Relevant console errors.
- Browser and TradingView environment details.

## License

Choose and add a license before distributing this project publicly.
