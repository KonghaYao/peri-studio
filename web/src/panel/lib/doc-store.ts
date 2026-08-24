import * as Y from 'yjs';
import { base64ToBytes } from './protocol';

/** Owns Y.Doc identity, v1 update application and render coalescing only. */
export class DocStore {
  private docs = new Map<string, Y.Doc>();
  private rafPending = new Set<string>();
  private generation = 0;
  private failedCount = 0;
  private removalObservers = new Set<(docId: string | null) => void>();
  onUpdate: ((docId: string) => void) | null = null;

  /** 失败更新累计数（只读，供统计/监控消费；applyUpdateFrame 失败时递增）。 */
  get failedUpdateCount(): number {
    return this.failedCount;
  }

  clear(): void {
    this.generation += 1;
    this.removalObservers.forEach((observer) => observer(null));
    this.docs.forEach((doc) => doc.destroy());
    this.docs.clear();
    this.rafPending.clear();
  }

  /**
   * 销毁单个 doc 的身份并清掉其待渲染标记（会话切换/退订时释放内存）。
   * 已排队的 rAF 回调由 scheduleRender 中的 rafPending 检查拦截，不会
   * 用已销毁的 doc 触发渲染；registry doc 由调用方保证永不 drop。
   */
  drop(docId: string): void {
    const doc = this.docs.get(docId);
    if (doc) {
      this.removalObservers.forEach((observer) => observer(docId));
      doc.destroy();
      this.docs.delete(docId);
    }
    this.rafPending.delete(docId);
  }

  /** 注册文档身份释放观察者；null 表示整个身份世代已清空。 */
  observeRemoval(observer: (docId: string | null) => void): () => void {
    this.removalObservers.add(observer);
    return () => this.removalObservers.delete(observer);
  }

  docFor(docId: string): Y.Doc {
    let doc = this.docs.get(docId);
    if (!doc) {
      doc = new Y.Doc();
      this.docs.set(docId, doc);
    }
    return doc;
  }

  applyUpdateFrame(frame: { doc: string; update: string }): void {
    const doc = this.docFor(frame.doc);
    try {
      Y.applyUpdate(doc, base64ToBytes(frame.update));
    } catch {
      // 更新失败：跳过渲染调度，避免用半更新状态渲染；仅计数并告警。
      this.failedCount += 1;
      console.warn(`applyUpdateFrame failed (doc=${frame.doc}, update_length=${frame.update.length}); render skipped`);
      return;
    }
    this.scheduleRender(frame.doc);
  }

  private scheduleRender(docId: string): void {
    if (this.rafPending.has(docId)) return;
    this.rafPending.add(docId);
    const generation = this.generation;
    requestAnimationFrame(() => {
      // A logout/reconnect may clear the store and schedule the same doc id for
      // a new connection before this callback runs. The old callback must not
      // delete or render the new generation's pending work.
      if (generation !== this.generation) return;
      // drop() 已移除该 doc 的待渲染标记：旧回调不得再触发渲染。
      if (!this.rafPending.has(docId)) return;
      this.rafPending.delete(docId);
      this.onUpdate?.(docId);
    });
  }
}
