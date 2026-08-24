export interface TranscriptWindowOptions {
  estimatedHeight: number;
  overscan: number;
}

export interface TranscriptAnchor {
  id: string;
  offset: number;
}

export interface TranscriptSlice {
  ids: string[];
  start: number;
  end: number;
  beforeHeight: number;
  afterHeight: number;
  totalHeight: number;
}

/** 变量高度 transcript 的窗口、测量缓存与 ID 锚点统一所有者。 */
export class TranscriptWindow {
  private ids: string[] = [];
  private indexById = new Map<string, number>();
  private heights = new Map<string, number>();
  private prefix: number[] = [0];

  constructor(private readonly options: TranscriptWindowOptions) {
    if (!(options.estimatedHeight > 0) || options.overscan < 0) {
      throw new Error('TranscriptWindow requires a positive estimate and non-negative overscan');
    }
  }

  setItems(ids: readonly string[]): boolean {
    if (ids.length === this.ids.length && ids.every((id, index) => id === this.ids[index])) return false;
    this.ids = [...ids];
    this.indexById = new Map();
    const retained = new Set(ids);
    for (const id of this.heights.keys()) {
      if (!retained.has(id)) this.heights.delete(id);
    }
    ids.forEach((id, index) => {
      if (!this.indexById.has(id)) this.indexById.set(id, index);
    });
    this.rebuildPrefix();
    return true;
  }

  measure(id: string, height: number): boolean {
    const index = this.indexById.get(id);
    if (index === undefined || !Number.isFinite(height) || height <= 0) return false;
    const normalized = Math.max(1, height);
    const previous = this.heights.get(id) ?? this.options.estimatedHeight;
    if (previous === normalized) return false;
    this.heights.set(id, normalized);
    const delta = normalized - previous;
    for (let cursor = index + 1; cursor < this.prefix.length; cursor += 1) {
      this.prefix[cursor] += delta;
    }
    return true;
  }

  slice(scrollTop: number, viewportHeight: number): TranscriptSlice {
    const totalHeight = this.prefix.at(-1) ?? 0;
    if (!this.ids.length) {
      return { ids: [], start: 0, end: 0, beforeHeight: 0, afterHeight: 0, totalHeight: 0 };
    }
    const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
    const viewport = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
    const startOffset = Math.max(0, top - this.options.overscan);
    const endOffset = Math.min(totalHeight, top + viewport + this.options.overscan);
    const start = this.indexAt(startOffset);
    const end = Math.min(this.ids.length, this.indexAt(Math.max(startOffset, endOffset - Number.EPSILON)) + 1);
    return {
      ids: this.ids.slice(start, end),
      start,
      end,
      beforeHeight: this.prefix[start] ?? 0,
      afterHeight: totalHeight - (this.prefix[end] ?? totalHeight),
      totalHeight,
    };
  }

  captureAnchor(scrollTop: number): TranscriptAnchor | null {
    if (!this.ids.length) return null;
    const top = Math.max(0, Math.min(Number.isFinite(scrollTop) ? scrollTop : 0, (this.prefix.at(-1) ?? 0) - 1));
    const index = this.indexAt(top);
    return { id: this.ids[index], offset: top - (this.prefix[index] ?? 0) };
  }

  restoreAnchor(anchor: TranscriptAnchor | null): number | null {
    if (!anchor) return null;
    const index = this.indexById.get(anchor.id);
    if (index === undefined) return null;
    return (this.prefix[index] ?? 0) + anchor.offset;
  }

  private rebuildPrefix(): void {
    const prefix = new Array<number>(this.ids.length + 1);
    prefix[0] = 0;
    for (let index = 0; index < this.ids.length; index += 1) {
      prefix[index + 1] = prefix[index] + (this.heights.get(this.ids[index]) ?? this.options.estimatedHeight);
    }
    this.prefix = prefix;
  }

  private indexAt(offset: number): number {
    let low = 0;
    let high = this.ids.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((this.prefix[middle + 1] ?? Number.POSITIVE_INFINITY) <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, this.ids.length - 1);
  }
}
