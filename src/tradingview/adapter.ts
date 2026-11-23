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

    const points = this.extractPoints(source);
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

  private extractPoints(source: TradingViewSource): PositionPoint[] | undefined {
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
    if (!chart) {
      console.warn("[Backtest Assistant][getCandleData] No chart instance available.");
      return [];
    }

    const chartObj = chart as Record<string, unknown>;
    const hasWindow = typeof window !== "undefined";
    const win = hasWindow ? (window as unknown as Record<string, unknown>) : ({} as Record<string, unknown>);

    // ── DIAGNOSTIC DUMP ─────────────────────────────────────────────────────
    console.group("[Backtest Assistant] getCandleData — diagnostic dump");
    try {
      const topKeys = Object.keys(chartObj).slice(0, 40);
      console.log("activeChart() top-level keys (first 40):", topKeys);
      console.log("has exportData:", typeof chartObj.exportData);
      console.log("has mainSeries:", typeof chartObj.mainSeries);
      console.log("has _mainSeries:", typeof chartObj._mainSeries);
      console.log("has _model:", typeof chartObj._model);
      console.log("has _chartWidget:", typeof chartObj._chartWidget);
      console.log("has chart:", typeof chartObj.chart);

      if (hasWindow) {
        // Log window-level widget references
        console.log("window.tvWidget:", typeof win["tvWidget"]);
        console.log("window._tv_chart_widget:", typeof win["_tv_chart_widget"]);
        console.log("window.TradingView:", typeof win["TradingView"]);
      }

      if (chartObj._model && typeof chartObj._model === "object") {
        const modelKeys = Object.keys(chartObj._model as object).slice(0, 40);
        console.log("_model top-level keys (first 40):", modelKeys);
        const model = chartObj._model as Record<string, unknown>;
        console.log("_model.mainSeries type:", typeof model.mainSeries);
        console.log("_model._mainSeries type:", typeof model._mainSeries);
        console.log("_model.panes type:", typeof model.panes);
        console.log("_model._panes type:", typeof model._panes);
      }
    } catch (diagErr) {
      console.warn("Diagnostic dump error:", diagErr);
    }
    console.groupEnd();
    // ────────────────────────────────────────────────────────────────────────

    // Strategy 0: window-level charting library widget (tvWidget / _tv_chart_widget)
    if (hasWindow) {
      for (const widgetKey of ["tvWidget", "_tv_chart_widget", "_chartWidget"]) {
        const widgetCandidate = win[widgetKey];
        if (!widgetCandidate || typeof widgetCandidate !== "object") continue;
        const w = widgetCandidate as Record<string, unknown>;
        // Some versions expose activeChart() on the top-level widget
        let widgetChart: Record<string, unknown> | null = null;
        if (typeof w.activeChart === "function") {
          try { widgetChart = (w.activeChart as () => Record<string, unknown>)(); } catch {}
        } else if (w.chart && typeof w.chart === "object") {
          widgetChart = w.chart as Record<string, unknown>;
        }
        if (!widgetChart) continue;
        if (typeof widgetChart.exportData === "function") {
          try {
            const exported = await (widgetChart.exportData as (opts: unknown) => Promise<unknown>)({
              includeTime: true, includeSeries: true, includedStudies: [],
            });
            const candles = this.parseExportedData(exported);
            if (candles.length > 0) {
              console.log(`[Backtest Assistant] Retrieved ${candles.length} candles via window.${widgetKey}.activeChart().exportData()`);
              return candles;
            }
          } catch (err) {
            console.warn(`[Backtest Assistant] window.${widgetKey} exportData failed:`, err);
          }
        }
      }
    }

    // Strategy 1: Official TradingView chart.exportData() API on activeChart()
    console.log("[Backtest Assistant] Trying Strategy 1: chart.exportData()...");
    if (typeof chartObj.exportData === "function") {
      try {
        const exported = await (
          chartObj.exportData as (opts: unknown) => Promise<unknown>
        )({
          includeTime: true,
          includeSeries: true,
          includedStudies: [],
        });
        const candles = this.parseExportedData(exported);
        console.log(`[Backtest Assistant] Strategy 1 result: ${candles.length} candles`);
        if (candles.length > 0) return candles;
      } catch (err) {
        console.warn("[Backtest Assistant] Strategy 1 (chart.exportData) failed:", err);
      }
    } else {
      console.log("[Backtest Assistant] Strategy 1 skipped: chart.exportData is not a function");
    }

    // Strategy 2: chart.mainSeries() / chart.mainSeries / chart._mainSeries
    console.log("[Backtest Assistant] Trying Strategy 2: chart.mainSeries...");
    let mainSeries: unknown = null;
    if (typeof chartObj.mainSeries === "function") {
      try {
        mainSeries = (chartObj.mainSeries as () => unknown)();
        console.log("[Backtest Assistant] Strategy 2: got mainSeries via chart.mainSeries()");
      } catch {}
    } else if (chartObj.mainSeries && typeof chartObj.mainSeries === "object") {
      mainSeries = chartObj.mainSeries;
      console.log("[Backtest Assistant] Strategy 2: got mainSeries via chart.mainSeries (object)");
    } else if (chartObj._mainSeries && typeof chartObj._mainSeries === "object") {
      mainSeries = chartObj._mainSeries;
      console.log("[Backtest Assistant] Strategy 2: got mainSeries via chart._mainSeries");
    }

    // Strategy 3: chart._model.mainSeries()
    console.log("[Backtest Assistant] Trying Strategy 3: chart._model.mainSeries...");
    if (!mainSeries && chartObj._model && typeof chartObj._model === "object") {
      const model = chartObj._model as Record<string, unknown>;
      if (typeof model.mainSeries === "function") {
        try {
          mainSeries = (model.mainSeries as () => unknown)();
          console.log("[Backtest Assistant] Strategy 3: got mainSeries via chart._model.mainSeries()");
        } catch {}
      } else if (model.mainSeries && typeof model.mainSeries === "object") {
        mainSeries = model.mainSeries;
        console.log("[Backtest Assistant] Strategy 3: got mainSeries via chart._model.mainSeries (object)");
      } else if (model._mainSeries && typeof model._mainSeries === "object") {
        mainSeries = model._mainSeries;
        console.log("[Backtest Assistant] Strategy 3: got mainSeries via chart._model._mainSeries");
      } else {
        console.log("[Backtest Assistant] Strategy 3 failed: _model has no mainSeries");
      }
    }

    // Strategy 4: Find mainSeries in chart._model.panes()[0].sources()
    console.log("[Backtest Assistant] Trying Strategy 4: panes traversal...");
    if (!mainSeries && chartObj._model && typeof chartObj._model === "object") {
      const model = chartObj._model as Record<string, unknown>;
      const panes = (
        typeof model.panes === "function" ? model.panes() : model._panes
      ) as unknown[];
      if (Array.isArray(panes)) {
        console.log(`[Backtest Assistant] Strategy 4: found ${panes.length} panes`);
        for (const pane of panes) {
          if (!pane || typeof pane !== "object") continue;
          const paneObj = pane as Record<string, unknown>;
          const sources = (
            typeof paneObj.sources === "function" ? paneObj.sources() : paneObj._sources
          ) as unknown[];
          if (Array.isArray(sources)) {
            console.log(`[Backtest Assistant] Strategy 4: pane has ${sources.length} sources`);
            for (const src of sources) {
              if (src && typeof src === "object") {
                const srcObj = src as Record<string, unknown>;
                const isMain =
                  srcObj._isMainSeries === true ||
                  (typeof srcObj.isMainSeries === "function" &&
                    (srcObj.isMainSeries as () => boolean)());
                console.log(`[Backtest Assistant] Strategy 4: source _isMainSeries=${srcObj._isMainSeries}, isMainSeries=${typeof srcObj.isMainSeries}`);
                if (isMain) {
                  mainSeries = src;
                  console.log("[Backtest Assistant] Strategy 4: found main series via panes");
                  break;
                }
              }
            }
          }
          if (mainSeries) break;
        }
      } else {
        console.log("[Backtest Assistant] Strategy 4: no panes array found");
      }
    }

    if (!mainSeries || typeof mainSeries !== "object") {
      console.warn("[Backtest Assistant] All strategies failed to find mainSeries. Returning [].");
      return [];
    }

    const seriesObj = mainSeries as Record<string, unknown>;
    const seriesKeys = Object.keys(seriesObj).slice(0, 40);
    console.log("[Backtest Assistant] mainSeries top-level keys (first 40):", seriesKeys);

    const rawItems: unknown[] = [];

    const collectFromObject = (col: unknown, label = "") => {
      if (!col || typeof col !== "object") return;
      const c = col as Record<string, unknown>;

      if (typeof (col as { all?: unknown }).all === "function") {
        try {
          const all = ((col as { all: () => unknown }).all)();
          if (Array.isArray(all)) {
            console.log(`[Backtest Assistant] collectFromObject(${label}): .all() → ${all.length} items`);
            rawItems.push(...all);
          }
        } catch {}
      }

      if (Array.isArray(c._items)) { console.log(`[Backtest Assistant] collectFromObject(${label}): ._items → ${c._items.length}`); rawItems.push(...c._items); }
      if (Array.isArray(c.items)) { console.log(`[Backtest Assistant] collectFromObject(${label}): .items → ${c.items.length}`); rawItems.push(...c.items); }
      if (Array.isArray(col)) { console.log(`[Backtest Assistant] collectFromObject(${label}): array → ${col.length}`); rawItems.push(...col); }

      if (c._plotRows && typeof c._plotRows === "object") {
        const pr = c._plotRows as Record<string, unknown>;
        if (Array.isArray(pr._items)) { console.log(`[Backtest Assistant] collectFromObject(${label}): _plotRows._items → ${pr._items.length}`); rawItems.push(...pr._items); }
        if (Array.isArray(pr.items)) { console.log(`[Backtest Assistant] collectFromObject(${label}): _plotRows.items → ${pr.items.length}`); rawItems.push(...pr.items); }
        if (typeof (pr as { all?: unknown }).all === "function") {
          try {
            const all = ((pr as { all: () => unknown }).all)();
            if (Array.isArray(all)) { console.log(`[Backtest Assistant] collectFromObject(${label}): _plotRows.all() → ${all.length}`); rawItems.push(...all); }
          } catch {}
        }
      }

      if (typeof c.plotRows === "function") {
        try {
          const pr = (c.plotRows as () => unknown)();
          if (Array.isArray(pr)) { console.log(`[Backtest Assistant] collectFromObject(${label}): plotRows() array → ${pr.length}`); rawItems.push(...pr); }
          else if (pr && typeof pr === "object") {
            const probj = pr as Record<string, unknown>;
            if (Array.isArray(probj._items)) { console.log(`[Backtest Assistant] collectFromObject(${label}): plotRows()._items → ${probj._items.length}`); rawItems.push(...probj._items); }
          }
        } catch {}
      }

      if (c._data && typeof c._data === "object") {
        collectFromObject(c._data, `${label}._data`);
      }

      if (rawItems.length === 0 && typeof (col as { each?: unknown }).each === "function") {
        try {
          let count = 0;
          (col as { each: (fn: (item: unknown, extra?: unknown) => void) => void }).each(
            (item: unknown, extra?: unknown) => {
              if (item) { rawItems.push(extra ?? item); count++; }
            },
          );
          if (count > 0) console.log(`[Backtest Assistant] collectFromObject(${label}): .each() → ${count} items`);
        } catch {}
      }

      if (
        rawItems.length === 0 &&
        typeof (col as { firstIndex?: unknown }).firstIndex === "function" &&
        typeof (col as { lastIndex?: unknown }).lastIndex === "function" &&
        typeof (col as { valueAt?: unknown }).valueAt === "function"
      ) {
        try {
          const first = ((col as { firstIndex: () => number }).firstIndex)();
          const last = ((col as { lastIndex: () => number }).lastIndex)();
          if (Number.isFinite(first) && Number.isFinite(last)) {
            console.log(`[Backtest Assistant] collectFromObject(${label}): valueAt range [${first}, ${last}]`);
            for (let i = first; i <= last; i++) {
              const val = ((col as { valueAt: (idx: number) => unknown }).valueAt)(i);
              if (val) rawItems.push(val);
            }
          }
        } catch {}
      }

      if (rawItems.length === 0 && typeof (col as { values?: unknown }).values === "function") {
        try {
          let count = 0;
          for (const val of col as Iterable<unknown>) {
            rawItems.push(val);
            count++;
          }
          if (count > 0) console.log(`[Backtest Assistant] collectFromObject(${label}): iterable → ${count} items`);
        } catch {}
      }
    };

    // Try collection properties on series
    for (const key of ["bars", "data", "_bars", "_data", "_plotRows"]) {
      console.log(`[Backtest Assistant] Trying series.${key} (type=${typeof seriesObj[key]})...`);
      if (typeof seriesObj[key] === "function") {
        try {
          const col = (seriesObj[key] as () => unknown)();
          collectFromObject(col, `series.${key}()`);
          if (rawItems.length > 0) {
            console.log(`[Backtest Assistant] Got ${rawItems.length} raw items from series.${key}()`);
            break;
          }
        } catch {}
      } else if (seriesObj[key]) {
        collectFromObject(seriesObj[key], `series.${key}`);
        if (rawItems.length > 0) {
          console.log(`[Backtest Assistant] Got ${rawItems.length} raw items from series.${key}`);
          break;
        }
      }
    }

    console.log(`[Backtest Assistant] Total rawItems collected: ${rawItems.length}`);
    if (rawItems.length > 0) {
      console.log("[Backtest Assistant] First rawItem sample:", JSON.stringify(rawItems[0]).slice(0, 200));
    }

    const candles: CandleBar[] = [];
    for (const item of rawItems) {
      const bar = this.normalizeCandleBar(item);
      if (bar) {
        candles.push(bar);
      }
    }

    console.log(`[Backtest Assistant] Normalized ${candles.length} CandleBar objects from ${rawItems.length} raw items.`);

    // Sort chronologically ascending
    candles.sort((a, b) => a.time - b.time);
    return candles;
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
