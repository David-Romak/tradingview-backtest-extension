import type { CandleBar } from "../analysis/types";
import type {
  PositionDrawing,
  PositionPoint,
  PositionPrices,
  PositionType,
  TradingViewApi,
  TradingViewChart,
  TradingViewPriceProperty,
  TradingViewShape,
  TradingViewSource,
  TradingViewSourceProperties,
} from "./types";

export const POSITION_TYPES = new Set<PositionType>([
  "long_position",
  "short_position",
]);

export class TradingViewAdapter {
  getApi(): TradingViewApi | null {
    if (typeof window === "undefined") {
      return null;
    }
    return ((window as unknown as Record<string, unknown>).TradingViewApi ??
      null) as TradingViewApi | null;
  }

  isChartReady(): boolean {
    const api = this.getApi();
    if (!api || typeof api.activeChart !== "function") {
      return false;
    }
    const chart = api.activeChart();
    return chart !== null && chart !== undefined;
  }

  getActiveChart(): TradingViewChart | null {
    const api = this.getApi();
    if (!api || typeof api.activeChart !== "function") {
      return null;
    }
    try {
      const chart = api.activeChart();
      return (chart as TradingViewChart) ?? null;
    } catch (err) {
      console.warn("[Backtest Assistant] Failed to get active chart:", err);
      return null;
    }
  }

  /**
   * Returns the IANA timezone string that the TradingView chart is currently
   * displaying (e.g. "America/New_York", "UTC", "Asia/Dubai").
   * Checks chart.getTimezone(), _timezoneApi, and chartWidget model timeScale.
   * Falls back to the browser's local timezone if chart API is unavailable.
   */
  getChartTimezone(chartInstance?: TradingViewChart): string {
    try {
      const chart = chartInstance ?? this.getActiveChart();
      if (!chart) return this.detectFallbackTimezone();
      const chartObj = chart as Record<string, unknown>;

      // 1. Direct chart methods
      if (typeof chartObj.getTimezone === "function") {
        try {
          const tz = this.cleanTimezone((chartObj.getTimezone as () => string)());
          if (tz) return tz;
        } catch {}
      }
      if (typeof chartObj.timezone === "function") {
        try {
          const tz = this.cleanTimezone((chartObj.timezone as () => string)());
          if (tz) return tz;
        } catch {}
      }

      // 2. _timezoneApi object
      const tzApi = chartObj._timezoneApi as Record<string, unknown> | undefined;
      if (tzApi && typeof tzApi === "object") {
        if (typeof tzApi.getTimezone === "function") {
          try {
            const tz = this.cleanTimezone((tzApi.getTimezone as () => string)());
            if (tz) return tz;
          } catch {}
        }
        if (typeof tzApi.timezone === "function") {
          try {
            const tz = this.cleanTimezone((tzApi.timezone as () => string)());
            if (tz) return tz;
          } catch {}
        }
        if (typeof tzApi.timezone === "string") {
          const tz = this.cleanTimezone(tzApi.timezone);
          if (tz) return tz;
        }
        if (tzApi.timezone && typeof (tzApi.timezone as { value?: unknown }).value === "function") {
          try {
            const tz = this.cleanTimezone((tzApi.timezone as { value: () => string }).value());
            if (tz) return tz;
          } catch {}
        }
      }

      // 3. _chartWidget -> model() -> timezone() or timeScale().timezone()
      if (chartObj._chartWidget && typeof chartObj._chartWidget === "object") {
        const cw = chartObj._chartWidget as Record<string, unknown>;
        let model: Record<string, unknown> | null = null;
        if (typeof cw.model === "function") {
          try {
            const m = (cw.model as () => unknown)();
            if (m && typeof m === "object") model = m as Record<string, unknown>;
          } catch {}
        } else if (cw.model && typeof cw.model === "object") {
          model = cw.model as Record<string, unknown>;
        }
        if (model) {
          if (typeof model.timezone === "function") {
            try {
              const tz = this.cleanTimezone((model.timezone as () => string)());
              if (tz) return tz;
            } catch {}
          }
          if (typeof model.timeScale === "function") {
            try {
              const ts = (model.timeScale as () => unknown)();
              if (ts && typeof ts === "object") {
                const tsObj = ts as Record<string, unknown>;
                if (typeof tsObj.timezone === "function") {
                  const tz = this.cleanTimezone((tsObj.timezone as () => string)());
                  if (tz) return tz;
                }
              }
            } catch {}
          }
        }
      }
    } catch {}

    return this.detectFallbackTimezone();
  }

  getTimezoneOffsetSeconds(timestampInSeconds: number, timezone: string): number {
    if (!timezone || timezone === "UTC") return 0;
    try {
      const date = new Date(timestampInSeconds * 1000);
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      const parts = Object.fromEntries(
        dtf.formatToParts(date).map((p) => [p.type, p.value]),
      );
      if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) {
        return 0;
      }
      const targetDate = new Date(
        `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second ?? "00"}Z`,
      );
      return Math.round((targetDate.getTime() - date.getTime()) / 1000);
    } catch {
      return 0;
    }
  }

  private cleanTimezone(tz: unknown): string | null {
    if (typeof tz !== "string" || !tz.trim()) return null;
    const t = tz.trim();
    if (t === "Etc/UTC" || t === "UTC" || t === "GMT") return "UTC";
    if (t === "exchange") return null;
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: t });
      return t;
    } catch {
      return null;
    }
  }

  private detectFallbackTimezone(): string {
    // Only fallback to browser local timezone if running in TradingView browser context
    if (
      typeof window !== "undefined" &&
      ((window as unknown as Record<string, unknown>).TradingViewApi ||
        (window as unknown as Record<string, unknown>).TradingView)
    ) {
      if (typeof Intl !== "undefined" && typeof Intl.DateTimeFormat === "function") {
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (tz && this.cleanTimezone(tz)) return tz;
        } catch {}
      }
    }
    return "UTC";
  }

  getPositionDrawings(chartInstance?: TradingViewChart): PositionDrawing[] {
    const chart = chartInstance ?? this.getActiveChart();
    if (!chart || typeof chart.getAllShapes !== "function") {
      return [];
    }

    let shapes: TradingViewShape[];
    try {
      shapes = chart.getAllShapes();
    } catch (err) {
      console.warn("[Backtest Assistant] Error calling getAllShapes():", err);
      return [];
    }

    if (!Array.isArray(shapes)) {
      return [];
    }

    const positionDrawings: PositionDrawing[] = [];

    for (const shape of shapes) {
      if (!POSITION_TYPES.has(shape.name as PositionType)) {
        continue;
      }

      const drawing = this.extractPositionDrawing(chart, shape);
      if (drawing) {
        positionDrawings.push(drawing);
      }
    }

    return positionDrawings;
  }

  extractPositionDrawing(
    chart: TradingViewChart,
    shape: TradingViewShape,
  ): PositionDrawing | null {
    if (!POSITION_TYPES.has(shape.name as PositionType)) {
      return null;
    }

    const source = this.resolveSource(chart, shape.id);
    if (!source) {
      console.warn(
        `[Backtest Assistant] Could not resolve drawing source for shape ${shape.id} (${shape.name})`,
      );
      return null;
    }

    const properties = this.extractProperties(source);
    if (!properties) {
      console.warn(
        `[Backtest Assistant] Missing properties on source for shape ${shape.id}`,
      );
      return null;
    }

    const entry = this.extractNumericPrice(properties.entryPrice);
    const stopLoss = this.extractNumericPrice(properties.stopPrice);
    const takeProfit = this.extractNumericPrice(properties.targetPrice);

    if (entry === null || stopLoss === null || takeProfit === null) {
      console.warn(
        `[Backtest Assistant] Incomplete prices for drawing ${shape.id}: entry=${entry}, sl=${stopLoss}, tp=${takeProfit}`,
      );
      return null;
    }

    const prices: PositionPrices = {
      entry,
      stopLoss,
      takeProfit,
    };

    const points = this.extractPoints(source, chart);
    // Logical point 0 is the entry point
    const entryTime =
      points && points.length > 0 && points[0]?.time
        ? points[0].time
        : undefined;

    return {
      id: shape.id,
      type: shape.name as PositionType,
      prices,
      points,
      entryTime,
    };
  }

  resolveSource(
    chart: TradingViewChart,
    id: string,
  ): TradingViewSource | null {
    // Strategy 1: chart.getShapeById(id)
    if (typeof chart.getShapeById === "function") {
      try {
        const entity = chart.getShapeById(id) as TradingViewSource | null;
        if (entity) {
          const unwrapped = this.unwrapSource(entity);
          if (unwrapped) return unwrapped;
        }
      } catch {
        // Ignore and proceed to next strategy
      }
    }

    // Strategy 2: chart._lineDataSources
    if (chart._lineDataSources) {
      const found = this.lookupInDataSourceCollection(
        chart._lineDataSources,
        id,
      );
      if (found) {
        const unwrapped = this.unwrapSource(found);
        if (unwrapped) return unwrapped;
      }
    }

    // Strategy 3: chart._model or chart.model()
    const chartObj = chart as Record<string, unknown>;
    const model = (chartObj._model ??
      (typeof chart.model === "function" ? chart.model() : null)) as
      | Record<string, unknown>
      | null;

    if (model) {
      // 3a. Model methods: dataSourceForId, lineDataSourceForId, getLineDataSourceById
      for (const methodName of [
        "dataSourceForId",
        "lineDataSourceForId",
        "getLineDataSourceById",
        "getDataSourceById",
      ]) {
        if (typeof model[methodName] === "function") {
          try {
            const res = (model[methodName] as (id: string) => unknown)(id);
            if (res) {
              const unwrapped = this.unwrapSource(res as TradingViewSource);
              if (unwrapped) return unwrapped;
            }
          } catch {
            // Ignore method failure
          }
        }
      }

      // 3b. model._lineDataSources or model.lineDataSources
      const modelSources =
        model._lineDataSources ??
        (typeof model.lineDataSources === "function"
          ? (model.lineDataSources as () => unknown)()
          : model.lineDataSources);

      if (modelSources) {
        const found = this.lookupInDataSourceCollection(modelSources, id);
        if (found) {
          const unwrapped = this.unwrapSource(found);
          if (unwrapped) return unwrapped;
        }
      }

      // 3c. model.panes() or model._panes
      const panes = (
        typeof model.panes === "function" ? model.panes() : model._panes
      ) as unknown[];

      if (Array.isArray(panes)) {
        for (const pane of panes) {
          if (!pane || typeof pane !== "object") continue;
          const paneObj = pane as Record<string, unknown>;

          for (const key of [
            "_sources",
            "_lineDataSources",
            "_dataSources",
            "sources",
            "orderedSources",
            "dataSources",
          ]) {
            const collection =
              typeof paneObj[key] === "function"
                ? (paneObj[key] as () => unknown)()
                : paneObj[key];

            if (collection) {
              const found = this.lookupInDataSourceCollection(collection, id);
              if (found) {
                const unwrapped = this.unwrapSource(found);
                if (unwrapped) return unwrapped;
              }
            }
          }
        }
      }
    }

    // Strategy 4: Fallback bounded search over chart and model properties
    const fallbackTarget = this.searchObjectGraph(chart, id, 2);
    if (fallbackTarget) {
      const unwrapped = this.unwrapSource(fallbackTarget);
      if (unwrapped) return unwrapped;
    }

    return null;
  }

  setStopLoss(
    chart: TradingViewChart,
    id: string,
    price: number,
  ): boolean {
    const source = this.resolveSource(chart, id);
    if (!source) {
      console.warn(`[Backtest Assistant] Cannot set SL: source not found for ${id}`);
      return false;
    }

    const properties = this.extractProperties(source);
    if (!properties?.stopPrice) {
      console.warn(`[Backtest Assistant] Cannot set SL: stopPrice property not found for ${id}`);
      return false;
    }

    const stopPriceProp = properties.stopPrice as TradingViewPriceProperty;
    if (typeof stopPriceProp.setValue === "function") {
      stopPriceProp.setValue(price);
      return true;
    }

    console.warn(`[Backtest Assistant] stopPrice.setValue is not a function for ${id}`);
    return false;
  }

  private lookupInDataSourceCollection(
    collection: unknown,
    targetId: string,
  ): TradingViewSource | null {
    if (!collection) return null;

    // Map: collection.get(targetId)
    if (
      typeof (collection as { get?: unknown }).get === "function"
    ) {
      const result = (collection as Map<string, unknown>).get(targetId);
      if (result) return result as TradingViewSource;
    }

    // Array: collection.find(...)
    if (Array.isArray(collection)) {
      for (const item of collection) {
        if (this.matchSourceId(item, targetId)) {
          return item as TradingViewSource;
        }
      }
    }

    // Plain object: collection[targetId] or matching property
    if (typeof collection === "object") {
      const record = collection as Record<string, unknown>;
      if (record[targetId]) {
        return record[targetId] as TradingViewSource;
      }
      for (const item of Object.values(record)) {
        if (this.matchSourceId(item, targetId)) {
          return item as TradingViewSource;
        }
      }
    }

    return null;
  }

  private matchSourceId(candidate: unknown, targetId: string): boolean {
    if (!candidate || typeof candidate !== "object") return false;
    const item = candidate as Record<string, unknown>;

    // id or id()
    if (item.id === targetId) return true;
    if (typeof item.id === "function" && (item.id as () => unknown)() === targetId) {
      return true;
    }

    // _id or _id()
    if (item._id === targetId) return true;
    if (typeof item._id === "function" && (item._id as () => unknown)() === targetId) {
      return true;
    }

    // _properties._id
    if (
      item._properties &&
      typeof item._properties === "object" &&
      (item._properties as Record<string, unknown>)._id === targetId
    ) {
      return true;
    }

    return false;
  }

  private unwrapSource(source: unknown): TradingViewSource | null {
    if (!source || typeof source !== "object") return null;
    const candidate = source as TradingViewSource;

    // Check if candidate or candidate._source has position properties
    if (candidate._properties?.entryPrice || candidate._properties?.stopPrice) {
      return candidate;
    }

    if (
      candidate._source?._properties?.entryPrice ||
      candidate._source?._properties?.stopPrice
    ) {
      return candidate._source;
    }

    if (typeof candidate.properties === "function") {
      try {
        const props = candidate.properties();
        if (props?.entryPrice || props?.stopPrice) {
          return candidate;
        }
      } catch {
        // Ignore
      }
    }

    return candidate;
  }

  private extractProperties(
    source: TradingViewSource,
  ): TradingViewSourceProperties | null {
    if (source._properties) {
      return source._properties;
    }

    if (source._source?._properties) {
      return source._source._properties;
    }

    if (typeof source.properties === "function") {
      try {
        return source.properties();
      } catch {
        // Ignore
      }
    }

    const sourceObj = source as Record<string, unknown>;
    if (sourceObj.entity && typeof sourceObj.entity === "object") {
      const entity = sourceObj.entity as TradingViewSource;
      return this.extractProperties(entity);
    }

    return null;
  }

  private extractNumericPrice(prop: unknown): number | null {
    if (prop === null || prop === undefined) return null;

    if (typeof prop === "number") {
      return Number.isFinite(prop) ? prop : null;
    }

    if (typeof prop === "object") {
      const propObj = prop as Record<string, unknown>;
      if (typeof propObj.value === "function") {
        try {
          const val = (propObj.value as () => unknown)();
          return typeof val === "number" && Number.isFinite(val) ? val : null;
        } catch {
          return null;
        }
      }
      if (typeof propObj.value === "number") {
        return Number.isFinite(propObj.value) ? propObj.value : null;
      }
    }

    return null;
  }

  private extractPoints(
    source: TradingViewSource,
    chart?: TradingViewChart,
  ): PositionPoint[] | undefined {
    let rawPoints: unknown = undefined;

    if (typeof source.points === "function") {
      try {
        rawPoints = source.points();
      } catch {
        // Ignore
      }
    }

    if (!rawPoints && source._points) {
      rawPoints = source._points;
    }

    if (!rawPoints && source._source) {
      if (typeof source._source.points === "function") {
        try {
          rawPoints = source._source.points();
        } catch {
          // Ignore
        }
      }
      if (!rawPoints && source._source._points) {
        rawPoints = source._source._points;
      }
    }

    if (!Array.isArray(rawPoints)) {
      return undefined;
    }

    const points: PositionPoint[] = [];
    for (let i = 0; i < rawPoints.length; i++) {
      const pt = rawPoints[i];
      if (pt && typeof pt === "object") {
        const record = pt as Record<string, unknown>;
        let rawTime = record.time ?? record.time_t ?? record.timestamp ?? record.t;
        if (typeof rawTime === "object" && rawTime instanceof Date) {
          rawTime = Math.floor(rawTime.getTime() / 1000);
        } else if (typeof rawTime === "string") {
          const parsed = Number(rawTime);
          if (!Number.isNaN(parsed) && parsed > 0) {
            rawTime = parsed;
          } else {
            const dateParsed = Date.parse(rawTime);
            if (!Number.isNaN(dateParsed)) {
              rawTime = Math.floor(dateParsed / 1000);
            }
          }
        }
        let time =
          typeof rawTime === "number" && Number.isFinite(rawTime) && rawTime > 0
            ? rawTime
            : 0;
        if (time > 1e11) {
          time = Math.floor(time / 1000);
        }

        // TradingView drawing points store timestamps in wall-clock time (offset by chart display timezone).
        // Normalize to true UTC Unix epoch seconds so drawings and price series bars share the exact same timeline.
        if (time > 0 && chart) {
          const tz = this.getChartTimezone(chart);
          if (tz && tz !== "UTC") {
            const offset = this.getTimezoneOffsetSeconds(time, tz);
            if (offset !== 0) {
              time = time - offset;
            }
          }
        }

        const price =
          typeof record.price === "number"
            ? record.price
            : 0;
        const index =
          typeof record.index === "number" ? record.index : i;
        points.push({ time, price, index });
      }
    }

    return points.length > 0 ? points : undefined;
  }

  private searchObjectGraph(
    root: unknown,
    targetId: string,
    maxDepth: number,
  ): TradingViewSource | null {
    if (maxDepth <= 0 || !root || typeof root !== "object") return null;

    const visited = new Set<unknown>();
    const queue: Array<{ obj: unknown; depth: number }> = [
      { obj: root, depth: 0 },
    ];

    while (queue.length > 0) {
      const { obj, depth } = queue.shift()!;
      if (!obj || typeof obj !== "object" || visited.has(obj)) continue;
      visited.add(obj);

      if (this.matchSourceId(obj, targetId)) {
        return obj as TradingViewSource;
      }

      if (depth < maxDepth) {
        // Check map
        if (typeof (obj as { get?: unknown }).get === "function") {
          const map = obj as Map<string, unknown>;
          if (map.has(targetId)) {
            return map.get(targetId) as TradingViewSource;
          }
        }

        // Iterate entries
        const values = Array.isArray(obj) ? obj : Object.values(obj);
        for (const val of values) {
          if (val && typeof val === "object" && !visited.has(val)) {
            queue.push({ obj: val, depth: depth + 1 });
          }
        }
      }
    }

    return null;
  }

  async getCandleData(chartInstance?: TradingViewChart): Promise<CandleBar[]> {
    const chart = chartInstance ?? this.getActiveChart();
    if (!chart) return [];

    const chartObj = chart as Record<string, unknown>;
    const hasWindow = typeof window !== "undefined";

    // Helper: given a model object, resolve mainSeries via all known patterns
    const resolveMainSeries = (model: Record<string, unknown>): unknown => {
      if (typeof model.mainSeries === "function") {
        try { return (model.mainSeries as () => unknown)(); } catch {}
      }
      if (model.mainSeries && typeof model.mainSeries === "object") return model.mainSeries;
      if (model._mainSeries && typeof model._mainSeries === "object") return model._mainSeries;

      // Panes traversal
      const panes = (typeof model.panes === "function"
        ? (() => { try { return (model.panes as () => unknown)(); } catch { return null; } })()
        : model._panes) as unknown[];
      if (Array.isArray(panes)) {
        for (const pane of panes) {
          if (!pane || typeof pane !== "object") continue;
          const p = pane as Record<string, unknown>;
          const sources = (typeof p.sources === "function"
            ? (() => { try { return (p.sources as () => unknown)(); } catch { return null; } })()
            : p._sources) as unknown[];
          if (!Array.isArray(sources)) continue;
          for (const src of sources) {
            if (!src || typeof src !== "object") continue;
            const s = src as Record<string, unknown>;
            const isMain =
              s._isMainSeries === true ||
              (typeof s.isMainSeries === "function" && (() => { try { return (s.isMainSeries as () => boolean)(); } catch { return false; } })());
            if (isMain) return src;
          }
        }
      }
      return null;
    };

    // Helper: collect raw bar items from a bars collection
    const collectBars = (col: unknown): unknown[] => {
      if (!col || typeof col !== "object") return [];
      const c = col as Record<string, unknown>;
      const items: unknown[] = [];

      // Preferred: ._items array (confirmed in production)
      if (Array.isArray(c._items)) return c._items;
      if (Array.isArray(c.items)) return c.items;
      if (Array.isArray(col)) return col as unknown[];

      // .all() method
      if (typeof (c as { all?: unknown }).all === "function") {
        try { const all = (c.all as () => unknown)(); if (Array.isArray(all)) return all; } catch {}
      }
      // _plotRows sub-object
      if (c._plotRows && typeof c._plotRows === "object") {
        const pr = c._plotRows as Record<string, unknown>;
        if (Array.isArray(pr._items)) return pr._items;
        if (Array.isArray(pr.items)) return pr.items;
        if (typeof (pr as { all?: unknown }).all === "function") {
          try { const all = (pr.all as () => unknown)(); if (Array.isArray(all)) return all; } catch {}
        }
      }
      // .plotRows() method
      if (typeof c.plotRows === "function") {
        try {
          const pr = (c.plotRows as () => unknown)();
          if (Array.isArray(pr)) return pr;
          if (pr && typeof pr === "object") {
            const prObj = pr as Record<string, unknown>;
            if (Array.isArray(prObj._items)) return prObj._items;
          }
        } catch {}
      }
      // Recurse into _data
      if (c._data && typeof c._data === "object") {
        const sub = collectBars(c._data);
        if (sub.length > 0) return sub;
      }
      // .each() iterator
      if (typeof (c as { each?: unknown }).each === "function") {
        try {
          (c as { each: (fn: (item: unknown, extra?: unknown) => void) => void })
            .each((item, extra) => { if (item) items.push(extra ?? item); });
          if (items.length > 0) return items;
        } catch {}
      }
      // firstIndex/lastIndex/valueAt range
      if (
        typeof (c as { firstIndex?: unknown }).firstIndex === "function" &&
        typeof (c as { lastIndex?: unknown }).lastIndex === "function" &&
        typeof (c as { valueAt?: unknown }).valueAt === "function"
      ) {
        try {
          const first = (c.firstIndex as () => number)();
          const last = (c.lastIndex as () => number)();
          if (Number.isFinite(first) && Number.isFinite(last)) {
            for (let i = first; i <= last; i++) {
              const val = (c.valueAt as (i: number) => unknown)(i);
              if (val) items.push(val);
            }
            if (items.length > 0) return items;
          }
        } catch {}
      }
      return items;
    };

    // Helper: given a mainSeries object, extract raw bars
    const extractBarsFromSeries = (series: unknown): unknown[] => {
      if (!series || typeof series !== "object") return [];
      const s = series as Record<string, unknown>;
      for (const key of ["bars", "data", "_bars", "_data", "_plotRows"]) {
        if (typeof s[key] === "function") {
          try {
            const col = (s[key] as () => unknown)();
            const items = collectBars(col);
            if (items.length > 0) return items;
          } catch {}
        } else if (s[key]) {
          const items = collectBars(s[key]);
          if (items.length > 0) return items;
        }
      }
      return [];
    };

    // Helper: normalize raw items to CandleBar[]
    const normalizeItems = (rawItems: unknown[]): CandleBar[] => {
      const candles: CandleBar[] = [];
      for (const item of rawItems) {
        const bar = this.normalizeCandleBar(item);
        if (bar) candles.push(bar);
      }
      candles.sort((a, b) => a.time - b.time);
      return candles;
    };

    // ── STRATEGY 1 (PRIMARY): chart._chartWidget.model().mainSeries().bars()._items
    // Confirmed working in production: activeChart()._chartWidget.model() returns the
    // internal chart model; model().mainSeries() returns the price series; .bars()._items
    // is an array of { index, value: [time_s, open, high, low, close, vol] }
    if (chartObj._chartWidget && typeof chartObj._chartWidget === "object") {
      const cw = chartObj._chartWidget as Record<string, unknown>;

      // Get model — it's a method (not a property) in production
      let model: Record<string, unknown> | null = null;
      if (typeof cw.model === "function") {
        try { const r = (cw.model as () => unknown)(); if (r && typeof r === "object") model = r as Record<string, unknown>; } catch {}
      } else if (cw._model && typeof cw._model === "object") {
        model = cw._model as Record<string, unknown>;
      }

      if (model) {
        const ms = resolveMainSeries(model);
        if (ms) {
          const rawItems = extractBarsFromSeries(ms);
          if (rawItems.length > 0) {
            const candles = normalizeItems(rawItems);
            console.log(`[Backtest Assistant] Retrieved ${candles.length} candles via _chartWidget.model().mainSeries()`);
            return candles;
          }
        }
      }

      // Also try cw.mainSeries() directly
      if (!model) {
        const ms = resolveMainSeries(cw);
        if (ms) {
          const rawItems = extractBarsFromSeries(ms);
          if (rawItems.length > 0) {
            const candles = normalizeItems(rawItems);
            console.log(`[Backtest Assistant] Retrieved ${candles.length} candles via _chartWidget.mainSeries()`);
            return candles;
          }
        }
      }
    }

    // ── STRATEGY 2: chart.exportData() (async, may be blocked on tradingview.com)
    if (typeof chartObj.exportData === "function") {
      try {
        const exported = await (chartObj.exportData as (opts: unknown) => Promise<unknown>)({
          includeTime: true, includeSeries: true, includedStudies: [],
        });
        const candles = this.parseExportedData(exported);
        if (candles.length > 0) {
          console.log(`[Backtest Assistant] Retrieved ${candles.length} candles via chart.exportData()`);
          return candles;
        }
      } catch { /* blocked in production */ }
    }

    // ── STRATEGY 3: chart.mainSeries() / chart._model.mainSeries() — direct properties
    for (const root of [chartObj, ...(chartObj._model && typeof chartObj._model === "object" ? [chartObj._model as Record<string, unknown>] : [])]) {
      const ms = resolveMainSeries(root as Record<string, unknown>);
      if (ms) {
        const rawItems = extractBarsFromSeries(ms);
        if (rawItems.length > 0) {
          const candles = normalizeItems(rawItems);
          console.log(`[Backtest Assistant] Retrieved ${candles.length} candles via chart._model.mainSeries()`);
          return candles;
        }
      }
    }

    // ── STRATEGY 4: window-level widget references (tvWidget, etc.)
    if (hasWindow) {
      const win = window as unknown as Record<string, unknown>;
      for (const widgetKey of ["tvWidget", "_tv_chart_widget"]) {
        const w = win[widgetKey];
        if (!w || typeof w !== "object") continue;
        const wo = w as Record<string, unknown>;
        // Try exportData on widget.activeChart()
        let wChart: Record<string, unknown> | null = null;
        if (typeof wo.activeChart === "function") {
          try { const r = (wo.activeChart as () => unknown)(); if (r && typeof r === "object") wChart = r as Record<string, unknown>; } catch {}
        }
        if (wChart && typeof wChart.exportData === "function") {
          try {
            const exported = await (wChart.exportData as (opts: unknown) => Promise<unknown>)({
              includeTime: true, includeSeries: true, includedStudies: [],
            });
            const candles = this.parseExportedData(exported);
            if (candles.length > 0) {
              console.log(`[Backtest Assistant] Retrieved ${candles.length} candles via ${widgetKey}.activeChart().exportData()`);
              return candles;
            }
          } catch {}
        }
      }
    }

    console.warn("[Backtest Assistant] getCandleData: all strategies exhausted, returning [].");
    return [];
  }


  private parseExportedData(raw: unknown): CandleBar[] {
    if (!raw || typeof raw !== "object") return [];
    const obj = raw as Record<string, unknown>;
    const schema = obj.schema as Array<Record<string, unknown>> | undefined;
    const data = obj.data as unknown[] | undefined;

    if (!Array.isArray(data) || data.length === 0) return [];

    let timeIdx = 0;
    let openIdx = 1;
    let highIdx = 2;
    let lowIdx = 3;
    let closeIdx = 4;

    if (Array.isArray(schema)) {
      for (let i = 0; i < schema.length; i++) {
        const field = schema[i];
        if (!field || typeof field !== "object") continue;
        const type = String(field.type ?? "").toLowerCase();
        const plotTitle = String(field.plotTitle ?? "").toLowerCase();
        const name = String(field.name ?? "").toLowerCase();

        if (type === "time" || name === "time") {
          timeIdx = i;
        } else if (plotTitle === "open" || name === "open") {
          openIdx = i;
        } else if (plotTitle === "high" || name === "high") {
          highIdx = i;
        } else if (plotTitle === "low" || name === "low") {
          lowIdx = i;
        } else if (plotTitle === "close" || name === "close") {
          closeIdx = i;
        }
      }
    }

    const candles: CandleBar[] = [];
    for (const row of data) {
      if (!Array.isArray(row)) continue;
      let time = Number(row[timeIdx]);
      const open = Number(row[openIdx]);
      const high = Number(row[highIdx]);
      const low = Number(row[lowIdx]);
      const close = Number(row[closeIdx]);

      if (
        !Number.isFinite(time) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        continue;
      }

      if (time > 1e11) {
        time = Math.floor(time / 1000);
      }

      candles.push({ time, open, high, low, close });
    }

    candles.sort((a, b) => a.time - b.time);
    return candles;
  }

  private normalizeCandleBar(raw: unknown): CandleBar | null {
    if (!raw || typeof raw !== "object") return null;

    let time = 0;
    let open = NaN;
    let high = NaN;
    let low = NaN;
    let close = NaN;

    // Array format: [time, open, high, low, close, volume]
    if (Array.isArray(raw)) {
      time = Number(raw[0]);
      open = Number(raw[1]);
      high = Number(raw[2]);
      low = Number(raw[3]);
      close = Number(raw[4]);
    } else {
      const rec = raw as Record<string, unknown>;

      // PlotRow format: rec.value = [time, open, high, low, close]
      if (Array.isArray(rec.value)) {
        if (rec.value.length >= 5) {
          time = Number(rec.value[0]);
          open = Number(rec.value[1]);
          high = Number(rec.value[2]);
          low = Number(rec.value[3]);
          close = Number(rec.value[4]);
        } else if (rec.value.length === 4) {
          time = Number(rec.time ?? rec.time_t ?? rec.timestamp ?? rec.t ?? 0);
          open = Number(rec.value[0]);
          high = Number(rec.value[1]);
          low = Number(rec.value[2]);
          close = Number(rec.value[3]);
        }
      }

      // Check rec.data or rec.values
      if (Number.isNaN(open) && Array.isArray(rec.data) && rec.data.length >= 4) {
        open = Number(rec.data[0]);
        high = Number(rec.data[1]);
        low = Number(rec.data[2]);
        close = Number(rec.data[3]);
      }

      if (time === 0) {
        time = Number(rec.time ?? rec.time_t ?? rec.timestamp ?? rec.t ?? 0);
      }
      if (Number.isNaN(open)) {
        open = Number(rec.open ?? rec.o ?? rec.openPrice ?? NaN);
      }
      if (Number.isNaN(high)) {
        high = Number(rec.high ?? rec.h ?? rec.maxPrice ?? NaN);
      }
      if (Number.isNaN(low)) {
        low = Number(rec.low ?? rec.l ?? rec.minPrice ?? NaN);
      }
      if (Number.isNaN(close)) {
        close = Number(rec.close ?? rec.c ?? rec.closePrice ?? NaN);
      }
    }

    if (!Number.isFinite(time) || time <= 0) return null;
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      return null;
    }

    // If time is in milliseconds (e.g. 1700000000000), convert to seconds
    if (time > 1e11) {
      time = Math.floor(time / 1000);
    }

    return { time, open, high, low, close };
  }
}
