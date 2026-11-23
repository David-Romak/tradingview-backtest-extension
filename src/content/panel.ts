import type { PositionWithMetadata, TradeMetadata } from "../metadata/types";

export interface PanelCallbacks {
  onMetadataChange: (
    drawingId: string,
    metadata: Partial<TradeMetadata>,
  ) => void;
  onCleanupOrphans?: () => void;
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

  constructor(callbacks: PanelCallbacks) {
    this.callbacks = callbacks;
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

  getPositions(): PositionWithMetadata[] {
    return this.positions;
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
          <div class="empty-desc">Draw a Long or Short Position on TradingView to begin recording metadata.</div>
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

        <div class="cards-container">
          ${cardsHtml}
        </div>

        <div class="footer">
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

  private renderPositionCard(pos: PositionWithMetadata): string {
    const isLong = pos.type === "long_position";
    const typeLabel = isLong ? "LONG" : "SHORT";
    const typeBadgeClass = isLong ? "badge-long" : "badge-short";

    const risk = Math.abs(pos.prices.entry - pos.prices.stopLoss);
    const reward = Math.abs(pos.prices.takeProfit - pos.prices.entry);
    const rr = risk > 0 ? (reward / risk).toFixed(2) : "N/A";

    const dateStr = pos.entryTime
      ? new Date(pos.entryTime * 1000).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "N/A";

    return `
      <div class="card" data-drawing-id="${pos.id}">
        <div class="card-header">
          <div class="card-header-left">
            <span class="badge ${typeBadgeClass}">${typeLabel}</span>
            <span class="drawing-id">#${pos.id}</span>
            <span class="entry-date">${dateStr}</span>
          </div>
          <div class="card-header-right">
            <span class="rr-badge">1:${rr} RR</span>
          </div>
        </div>

        <div class="prices-row">
          <div class="price-chip">Entry: <b>${pos.prices.entry}</b></div>
          <div class="price-chip price-sl">SL: <b>${pos.prices.stopLoss}</b></div>
          <div class="price-chip price-tp">TP: <b>${pos.prices.takeProfit}</b></div>
        </div>

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

    this.shadow.getElementById("btn-cleanup")?.addEventListener("click", () => {
      if (this.callbacks.onCleanupOrphans) {
        this.callbacks.onCleanupOrphans();
      }
    });

    const inputs = this.shadow.querySelectorAll<HTMLInputElement>(".input-field");
    inputs.forEach((input) => {
      // Isolate keyboard events directly at the input element level
      // Calling stopPropagation() ensures the event NEVER bubbles to document or window,
      // which completely prevents TradingView's global shortcut listeners from intercepting it.
      // Crucially, we DO NOT call preventDefault(), so native typing, cursor keys, selection,
      // Backspace, Delete, Ctrl+A, and paste all function completely normally.
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
          justify-content: flex-end;
        }
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
