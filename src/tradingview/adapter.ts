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
        const time =
          typeof record.time === "number"
            ? record.time
            : typeof record.time_t === "number"
              ? record.time_t
              : 0;
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
}
