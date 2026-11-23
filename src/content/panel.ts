import type { TradeAnalysisResult } from "../analysis/types";
import type { PositionWithMetadata, TradeMetadata } from "../metadata/types";
import { calculateStopLoss } from "../rr/calculator";
import type { RRCalculationResult, RRConfig } from "../rr/types";

export interface PanelCallbacks {
  onMetadataChange: (
    drawingId: string,
    metadata: Partial<TradeMetadata>,
  ) => void;
  onCleanupOrphans?: () => void;
  onRRConfigChange?: (config: RRConfig) => void;
  onRequestAnalysis?: () => void;
  onExportCSV?: () => void;
}

export function sortPositionsNewestFirst(
  positions: PositionWithMetadata[],
): PositionWithMetadata[] {
  return [...positions].sort((a, b) => {
    const timeA =
      typeof a.entryTime === "number" && a.entryTime > 0
        ? a.entryTime
        : (a.metadata?.updatedAt ?? 0);
    const timeB =
      typeof b.entryTime === "number" && b.entryTime > 0
        ? b.entryTime
        : (b.metadata?.updatedAt ?? 0);

    if (timeB !== timeA) {
      return timeB - timeA; // Descending: newest on top
    }
    return b.id.localeCompare(a.id);
  });
}

export class BacktestPanel {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private positions: PositionWithMetadata[] = [];
  private callbacks: PanelCallbacks;
  private isMinimized = false;
  private activeSymbol = "";
  private rrConfig: RRConfig = { enabled: true, defaultRR: 1.5 };
  private analysisResults: Map<string, TradeAnalysisResult> = new Map();
  private isAnalyzing = false;
  private chartTimezone = "UTC";

  constructor(callbacks: PanelCallbacks, initialRRConfig?: Partial<RRConfig>) {
    this.callbacks = callbacks;
    if (initialRRConfig) {
      this.rrConfig = {
        enabled: initialRRConfig.enabled ?? true,
        defaultRR: initialRRConfig.defaultRR ?? 1.5,
      };
    }
  }

  mount(): void {
    if (this.container || typeof document === "undefined") {
      return;
    }

    this.container = document.createElement("div");
    this.container.id = "backtest-assistant-root";
    this.container.style.position = "fixed";
    this.container.style.top = "60px";
    this.container.style.right = "16px";
    this.container.style.zIndex = "9999999";
    this.container.style.fontFamily =
      "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

    // Stop keyboard propagation on the host container as the outermost boundary
    const stopPropagationHandler = (e: Event) => {
      e.stopPropagation();
    };

    for (const eventType of ["keydown", "keyup", "keypress"]) {
      this.container.addEventListener(eventType, stopPropagationHandler);
    }

    this.shadow = this.container.attachShadow({ mode: "open" });

    // Stop keyboard propagation on the shadow root as well
    for (const eventType of ["keydown", "keyup", "keypress"]) {
      this.shadow.addEventListener(eventType, stopPropagationHandler);
    }

    this.render();
    document.body.appendChild(this.container);
  }

  unmount(): void {
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
      this.shadow = null;
    }
  }

  setPositions(positions: PositionWithMetadata[], symbol?: string): void {
    // Arrange in order with newest drawing timestamp on top
    this.positions = sortPositionsNewestFirst(positions);
    if (symbol) this.activeSymbol = symbol;
    this.render();
  }

  setRRConfig(config: Partial<RRConfig>): void {
    if (typeof config.enabled === "boolean") {
      this.rrConfig.enabled = config.enabled;
    }
    if (typeof config.defaultRR === "number" && config.defaultRR > 0) {
      this.rrConfig.defaultRR = config.defaultRR;
    }
    this.render();
  }

  getPositions(): PositionWithMetadata[] {
    return this.positions;
  }

  setAnalysisResults(
    results: Map<string, TradeAnalysisResult> | TradeAnalysisResult[],
  ): void {
    if (Array.isArray(results)) {
      this.analysisResults = new Map(results.map((r) => [r.drawingId, r]));
    } else {
      this.analysisResults = new Map(results);
    }
    this.isAnalyzing = false;
    this.render();
  }

  setAnalyzing(analyzing: boolean): void {
    this.isAnalyzing = analyzing;
    this.render();
  }

  getAnalysisResults(): Map<string, TradeAnalysisResult> {
    return this.analysisResults;
  }

  setChartTimezone(tz?: string): void {
    if (tz && tz.trim() && this.chartTimezone !== tz.trim()) {
      this.chartTimezone = tz.trim();
      this.render();
    }
  }

  getChartTimezone(): string {
    return this.chartTimezone;
  }

  getContainer(): HTMLDivElement | null {
    return this.container;
  }

  getShadowRoot(): ShadowRoot | null {
    return this.shadow;
  }

  private toggleMinimize(): void {
    this.isMinimized = !this.isMinimized;
    this.render();
  }

  private render(): void {
    if (!this.shadow) return;

    // Preserve active input focus and cursor position across re-renders
    const activeEl = this.shadow.activeElement as HTMLInputElement | null;
    const activeDrawingId = activeEl?.getAttribute("data-id");
    const activeField = activeEl?.getAttribute("data-field");
    const selectionStart = activeEl?.selectionStart;
    const selectionEnd = activeEl?.selectionEnd;

    if (this.isMinimized) {
      this.shadow.innerHTML = `
        ${this.getStyles()}
        <div class="pill" id="btn-toggle">
          <span class="pill-dot"></span>
          <span class="pill-title">Backtest Assistant</span>
          <span class="pill-badge">${this.positions.length}</span>
          ${this.rrConfig.enabled ? `<span class="pill-rr">RR ${this.rrConfig.defaultRR}</span>` : ""}
        </div>
      `;
      this.shadow.getElementById("btn-toggle")?.addEventListener("click", () => {
        this.toggleMinimize();
      });
      return;
    }

    const cardsHtml =
      this.positions.length === 0
        ? `
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <div class="empty-title">No Positions Detected</div>
          <div class="empty-desc">Draw a Long or Short Position on TradingView to begin. Stop-loss will automatically adjust to 1:${this.rrConfig.defaultRR} RR.</div>
        </div>
      `
        : this.positions
            .map((pos) => this.renderPositionCard(pos))
            .join("");

    this.shadow.innerHTML = `
      ${this.getStyles()}
      <div class="panel">
        <div class="header">
          <div class="header-left">
            <span class="title">Backtest Assistant</span>
            <span class="badge count-badge">${this.positions.length} Positions</span>
            ${this.activeSymbol ? `<span class="symbol-tag">${this.activeSymbol}</span>` : ""}
          </div>
          <div class="header-right">
            <button class="icon-btn" id="btn-minimize" title="Minimize">−</button>
          </div>
        </div>

        <div class="toolbar">
          <div class="toolbar-left">
            <div class="toolbar-item">
              <label class="toggle-label" title="Enable or disable automatic Stop-Loss adjustments">
                <input type="checkbox" id="chk-auto-rr" ${this.rrConfig.enabled ? "checked" : ""} />
                <span>Auto SL</span>
              </label>
            </div>
            <div class="toolbar-item">
              <span class="toolbar-label">RR:</span>
              <input 
                type="number" 
                id="input-target-rr" 
                class="toolbar-input" 
                step="0.1" 
                min="0.1" 
                max="20"
                value="${this.rrConfig.defaultRR}" 
                title="Target Risk-to-Reward ratio (default 1.5)"
              />
            </div>
          </div>
          <div class="toolbar-right">
            <button class="action-btn" id="btn-analyze" title="Run historical candle backtest on active drawings">
              ${this.isAnalyzing ? "⏳ Analyzing..." : "📈 Analyze"}
            </button>
            <button class="action-btn secondary" id="btn-export-csv" title="Export trade metrics to CSV matching spreadsheet schema">
              📥 Export CSV
            </button>
          </div>
        </div>

        <div class="cards-container">
          ${cardsHtml}
        </div>

        <div class="footer">
          <div class="footer-stats">
            ${this.getOutcomeStatsSummary()}
          </div>
          <button class="footer-btn" id="btn-cleanup" title="Remove stored records for drawings deleted from chart">
            🧹 Clean Deleted Drawings
          </button>
        </div>
      </div>
    `;

    this.attachEventListeners();

    // Restore focus and cursor selection if an input was previously active
    if (activeDrawingId && activeField) {
      const newActive = this.shadow.querySelector<HTMLInputElement>(
        `input[data-id="${activeDrawingId}"][data-field="${activeField}"]`,
      );
      if (newActive) {
        newActive.focus();
        if (typeof selectionStart === "number" && typeof selectionEnd === "number") {
          try {
            newActive.setSelectionRange(selectionStart, selectionEnd);
          } catch {}
        }
      }
    }
  }

  private getOutcomeStatsSummary(): string {
    if (this.analysisResults.size === 0) return "";
    let tp = 0;
    let sl = 0;
    let amb = 0;
    let open = 0;
    for (const pos of this.positions) {
      const res = this.analysisResults.get(pos.id);
      if (!res) continue;
      if (res.result === "TP") tp++;
      else if (res.result === "SL") sl++;
      else if (res.result === "AMBIGUOUS") amb++;
      else if (res.result === "OPEN") open++;
    }
    const parts: string[] = [];
    if (tp > 0) parts.push(`<span class="stat-tp">${tp} TP</span>`);
    if (sl > 0) parts.push(`<span class="stat-sl">${sl} SL</span>`);
    if (amb > 0) parts.push(`<span class="stat-amb">${amb} AMB</span>`);
    if (open > 0) parts.push(`<span class="stat-open">${open} OPEN</span>`);
    return parts.join(" • ");
  }

  private renderPositionCard(pos: PositionWithMetadata): string {
    const isLong = pos.type === "long_position";
    const typeLabel = isLong ? "LONG" : "SHORT";
    const typeBadgeClass = isLong ? "badge-long" : "badge-short";

    const calc = calculateStopLoss({
      type: pos.type,
      entry: pos.prices.entry,
      takeProfit: pos.prices.takeProfit,
      targetRR: this.rrConfig.defaultRR,
      symbol: this.activeSymbol,
    });

    const risk = Math.abs(pos.prices.entry - pos.prices.stopLoss);
    const reward = Math.abs(pos.prices.takeProfit - pos.prices.entry);
    const actualRR = risk > 0 ? (reward / risk).toFixed(2) : "N/A";

    const tz = this.chartTimezone || "UTC";
    let dateStr = "N/A";
    if (pos.entryTime) {
      try {
        dateStr = new Intl.DateTimeFormat(undefined, {
          timeZone: tz,
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(pos.entryTime * 1000));
      } catch {
        dateStr = new Date(pos.entryTime * 1000).toISOString().slice(5, 16).replace("T", " ");
      }
    }

    const warningHtml = !calc.isValid
      ? `<div class="warning-banner" title="${calc.error}">⚠ ${calc.error}</div>`
      : "";

    const analysis = this.analysisResults.get(pos.id);

    const outcomeBadgeHtml = analysis
      ? `<span class="badge badge-${analysis.result.toLowerCase()}" title="Historical outcome">${analysis.result}</span>`
      : "";

    const analysisRowHtml = analysis
      ? `
        <div class="analysis-row">
          <div class="metric-chip mfe" title="Maximum Favorable Excursion (pips)">MFE: <b>+${analysis.mfePips}p</b></div>
          <div class="metric-chip mae" title="Maximum Adverse Excursion (pips)">MAE: <b>-${analysis.maePips}p</b></div>
          <div class="metric-chip dd" title="Drawdown (user convention: SL=MFE, TP=MAE)">DD: <b>${analysis.ddPips}p</b></div>
          ${
            analysis.outcomeDateStr
              ? `<div class="metric-chip outcome-time" title="Outcome Time">@ <b>${analysis.outcomeDateStr}</b></div>`
              : ""
          }
        </div>
        ${
          analysis.notes
            ? `<div class="analysis-warning" title="${this.escapeHtml(analysis.notes)}">⚠ ${this.escapeHtml(analysis.notes)}</div>`
            : ""
        }
      `
      : "";

    return `
      <div class="card" data-drawing-id="${pos.id}">
        <div class="card-header">
          <div class="card-header-left">
            <span class="badge ${typeBadgeClass}">${typeLabel}</span>
            <span class="drawing-id">#${pos.id}</span>
            <span class="entry-date">${dateStr}</span>
          </div>
          <div class="card-header-right">
            ${outcomeBadgeHtml}
            <span class="rr-badge" title="Actual Risk-Reward Ratio">1:${actualRR} RR</span>
          </div>
        </div>

        ${warningHtml}

        <div class="prices-row">
          <div class="price-chip">Entry: <b>${pos.prices.entry}</b></div>
          <div class="price-chip price-sl">SL: <b>${pos.prices.stopLoss}</b></div>
          <div class="price-chip price-tp">TP: <b>${pos.prices.takeProfit}</b></div>
        </div>

        ${analysisRowHtml}

        <div class="form-grid">
          <div class="form-field">
            <label>Trade Type</label>
            <input 
              type="text" 
              class="input-field input-type" 
              placeholder="e.g. A0, B0, WTB" 
              value="${this.escapeHtml(pos.metadata.type)}" 
              data-id="${pos.id}"
              data-field="type"
            />
          </div>

          <div class="form-field">
            <label>Break-time – Entry-time</label>
            <input 
              type="text" 
              class="input-field input-break-time" 
              placeholder="e.g. 08:30 - 09:15" 
              value="${this.escapeHtml(pos.metadata.breakEntryTime)}" 
              data-id="${pos.id}"
              data-field="breakEntryTime"
            />
          </div>
        </div>

        <div class="form-field" style="margin-top: 8px;">
          <label>Notes</label>
          <input 
            type="text" 
            class="input-field input-notes" 
            placeholder="Setup notes or observations..." 
            value="${this.escapeHtml(pos.metadata.notes)}" 
            data-id="${pos.id}"
            data-field="notes"
          />
        </div>

        <div class="card-status" id="status-${pos.id}"></div>
      </div>
    `;
  }

  private attachEventListeners(): void {
    if (!this.shadow) return;

    this.shadow.getElementById("btn-minimize")?.addEventListener("click", () => {
      this.toggleMinimize();
    });

    this.shadow.getElementById("btn-analyze")?.addEventListener("click", () => {
      if (this.callbacks.onRequestAnalysis) {
        this.callbacks.onRequestAnalysis();
      }
    });

    this.shadow.getElementById("btn-export-csv")?.addEventListener("click", () => {
      if (this.callbacks.onExportCSV) {
        this.callbacks.onExportCSV();
      }
    });

    this.shadow.getElementById("btn-cleanup")?.addEventListener("click", () => {
      if (this.callbacks.onCleanupOrphans) {
        this.callbacks.onCleanupOrphans();
      }
    });

    // Auto-RR toggle
    const chkAutoRR = this.shadow.getElementById("chk-auto-rr") as HTMLInputElement | null;
    chkAutoRR?.addEventListener("change", () => {
      this.rrConfig.enabled = chkAutoRR.checked;
      if (this.callbacks.onRRConfigChange) {
        this.callbacks.onRRConfigChange({ ...this.rrConfig });
      }
    });

    // Target RR input
    const inputTargetRR = this.shadow.getElementById("input-target-rr") as HTMLInputElement | null;
    const updateTargetRR = () => {
      const val = parseFloat(inputTargetRR?.value ?? "");
      if (Number.isFinite(val) && val > 0) {
        this.rrConfig.defaultRR = val;
        if (this.callbacks.onRRConfigChange) {
          this.callbacks.onRRConfigChange({ ...this.rrConfig });
        }
      }
    };
    inputTargetRR?.addEventListener("change", updateTargetRR);
    inputTargetRR?.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        updateTargetRR();
      }
    });
    inputTargetRR?.addEventListener("keyup", (e) => e.stopPropagation());

    const inputs = this.shadow.querySelectorAll<HTMLInputElement>(".input-field");
    inputs.forEach((input) => {
      const stopKeyHandler = (e: KeyboardEvent) => {
        e.stopPropagation();
      };

      input.addEventListener("keydown", stopKeyHandler);
      input.addEventListener("keyup", stopKeyHandler);
      input.addEventListener("keypress", stopKeyHandler);

      const changeHandler = () => {
        const id = input.getAttribute("data-id");
        const field = input.getAttribute("data-field");
        if (!id || !field) return;

        this.callbacks.onMetadataChange(id, {
          [field]: input.value,
        });

        this.showSavedIndicator(id);
      };

      input.addEventListener("input", changeHandler);
      input.addEventListener("change", changeHandler);
    });
  }

  private showSavedIndicator(drawingId: string): void {
    if (!this.shadow) return;
    const el = this.shadow.getElementById(`status-${drawingId}`);
    if (el) {
      el.textContent = "Saved ✓";
      el.classList.add("saved-visible");
      setTimeout(() => {
        el.classList.remove("saved-visible");
      }, 1500);
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private getStyles(): string {
    return `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: 12px;
          color: #d1d4dc;
          box-sizing: border-box;
        }

        *, *:before, *:after {
          box-sizing: inherit;
        }

        .pill {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #1e222d;
          color: #ffffff;
          padding: 8px 14px;
          border-radius: 20px;
          border: 1px solid #2a2e39;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
          cursor: pointer;
          user-select: none;
          transition: transform 0.15s ease, background 0.15s ease;
        }
        .pill:hover {
          background: #2a2e39;
          transform: translateY(-1px);
        }
        .pill-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #2962ff;
        }
        .pill-title {
          font-weight: 600;
          font-size: 13px;
        }
        .pill-badge {
          background: #2962ff;
          color: white;
          padding: 2px 7px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 700;
        }
        .pill-rr {
          background: rgba(41, 98, 255, 0.2);
          color: #2962ff;
          border: 1px solid rgba(41, 98, 255, 0.4);
          padding: 2px 6px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 600;
        }

        .panel {
          width: 380px;
          max-height: 82vh;
          background: #1e222d;
          border: 1px solid #2a2e39;
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          background: #181b23;
          border-bottom: 1px solid #2a2e39;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .title {
          font-weight: 700;
          font-size: 13px;
          color: #ffffff;
        }
        .symbol-tag {
          background: #2a2e39;
          color: #787b86;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
        }
        .icon-btn {
          background: transparent;
          border: none;
          color: #787b86;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 4px 6px;
          border-radius: 4px;
        }
        .icon-btn:hover {
          background: #2a2e39;
          color: #ffffff;
        }

        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: #141720;
          border-bottom: 1px solid #2a2e39;
          font-size: 11px;
          gap: 8px;
        }
        .toolbar-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .toolbar-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .toolbar-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .toggle-label {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-weight: 600;
          color: #d1d4dc;
          user-select: none;
        }
        .toggle-label input[type="checkbox"] {
          accent-color: #2962ff;
          cursor: pointer;
        }
        .toolbar-label {
          color: #787b86;
          font-weight: 600;
        }
        .toolbar-input {
          width: 50px;
          background: #1e222d;
          border: 1px solid #2a2e39;
          border-radius: 4px;
          color: #ffffff;
          padding: 3px 6px;
          font-size: 11px;
          font-weight: 600;
          text-align: center;
          outline: none;
        }
        .toolbar-input:focus {
          border-color: #2962ff;
        }
        .action-btn {
          background: #2962ff;
          color: #ffffff;
          border: none;
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          transition: background 0.15s ease;
          user-select: none;
        }
        .action-btn:hover {
          background: #1e53e5;
        }
        .action-btn.secondary {
          background: #2a2e39;
          color: #d1d4dc;
        }
        .action-btn.secondary:hover {
          background: #363c4e;
          color: #ffffff;
        }

        .cards-container {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .card {
          background: #131722;
          border: 1px solid #2a2e39;
          border-radius: 8px;
          padding: 10px;
          position: relative;
        }
        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .card-header-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .count-badge {
          background: #2962ff;
          color: #ffffff;
        }
        .badge-long {
          background: rgba(8, 153, 129, 0.2);
          color: #089981;
          border: 1px solid rgba(8, 153, 129, 0.4);
        }
        .badge-short {
          background: rgba(242, 54, 69, 0.2);
          color: #f23645;
          border: 1px solid rgba(242, 54, 69, 0.4);
        }
        .badge-tp {
          background: rgba(8, 153, 129, 0.2);
          color: #089981;
          border: 1px solid rgba(8, 153, 129, 0.4);
        }
        .badge-sl {
          background: rgba(242, 54, 69, 0.2);
          color: #f23645;
          border: 1px solid rgba(242, 54, 69, 0.4);
        }
        .badge-ambiguous {
          background: rgba(255, 152, 0, 0.2);
          color: #ff9800;
          border: 1px solid rgba(255, 152, 0, 0.4);
        }
        .badge-open {
          background: rgba(41, 98, 255, 0.2);
          color: #2962ff;
          border: 1px solid rgba(41, 98, 255, 0.4);
        }
        .drawing-id {
          color: #787b86;
          font-size: 11px;
          font-family: monospace;
        }
        .entry-date {
          color: #787b86;
          font-size: 10px;
        }
        .rr-badge {
          background: #2a2e39;
          color: #f0b90b;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .warning-banner {
          background: rgba(242, 54, 69, 0.15);
          color: #f23645;
          border: 1px solid rgba(242, 54, 69, 0.3);
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 10px;
          margin-bottom: 8px;
          font-weight: 500;
        }

        .prices-row {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
        }
        .price-chip {
          flex: 1;
          background: #1e222d;
          padding: 4px 6px;
          border-radius: 4px;
          font-size: 10px;
          color: #b2b5be;
          text-align: center;
        }
        .price-chip b {
          color: #ffffff;
        }
        .price-sl b {
          color: #f23645;
        }
        .price-tp b {
          color: #089981;
        }

        .analysis-row {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 8px;
        }
        .metric-chip {
          background: #1e222d;
          border: 1px solid #2a2e39;
          padding: 3px 6px;
          border-radius: 4px;
          font-size: 10px;
          color: #b2b5be;
        }
        .metric-chip b {
          font-weight: 600;
        }
        .metric-chip.mfe b {
          color: #089981;
        }
        .metric-chip.mae b {
          color: #f23645;
        }
        .metric-chip.dd b {
          color: #ff9800;
        }
        .metric-chip.outcome-time {
          color: #787b86;
        }
        .analysis-warning {
          background: rgba(255, 152, 0, 0.15);
          color: #ff9800;
          border: 1px solid rgba(255, 152, 0, 0.3);
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 10px;
          margin-bottom: 8px;
          line-height: 1.3;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .form-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .form-field label {
          font-size: 10px;
          font-weight: 600;
          color: #787b86;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .input-field {
          background: #1e222d;
          border: 1px solid #2a2e39;
          border-radius: 4px;
          color: #ffffff;
          padding: 6px 8px;
          font-size: 11px;
          outline: none;
          transition: border-color 0.15s ease;
        }
        .input-field:focus {
          border-color: #2962ff;
        }
        .input-field::placeholder {
          color: #434651;
        }

        .card-status {
          font-size: 10px;
          color: #089981;
          font-weight: 600;
          height: 14px;
          margin-top: 4px;
          text-align: right;
          opacity: 0;
          transition: opacity 0.2s ease;
        }
        .saved-visible {
          opacity: 1;
        }

        .empty-state {
          padding: 30px 20px;
          text-align: center;
        }
        .empty-icon {
          font-size: 32px;
          margin-bottom: 10px;
        }
        .empty-title {
          font-size: 13px;
          font-weight: 600;
          color: #ffffff;
          margin-bottom: 6px;
        }
        .empty-desc {
          font-size: 11px;
          color: #787b86;
          line-height: 1.4;
        }

        .footer {
          padding: 8px 12px;
          background: #181b23;
          border-top: 1px solid #2a2e39;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .footer-stats {
          font-size: 11px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .stat-tp { color: #089981; }
        .stat-sl { color: #f23645; }
        .stat-amb { color: #ff9800; }
        .stat-open { color: #2962ff; }
        .footer-btn {
          background: transparent;
          border: 1px solid #2a2e39;
          color: #787b86;
          font-size: 11px;
          padding: 5px 10px;
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .footer-btn:hover {
          background: #2a2e39;
          color: #d1d4dc;
        }
      </style>
    `;
  }
}
