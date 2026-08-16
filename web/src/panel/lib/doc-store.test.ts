import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { bytesToBase64 } from './protocol';
import { DocStore } from './doc-store';

describe('DocStore', () => {
  it('applies v1 updates and coalesces repeated renders for one document', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const source = new Y.Doc();
    source.getMap('root').set('status', 'ready');
    const frame = { doc: 'hub:registry', update: bytesToBase64(Y.encodeStateAsUpdate(source)) };
    const store = new DocStore();
    const onUpdate = vi.fn();
    store.onUpdate = onUpdate;

    store.applyUpdateFrame(frame);
    store.applyUpdateFrame(frame);

    expect(store.docFor(frame.doc).getMap('root').get('status')).toBe('ready');
    expect(callbacks).toHaveLength(1);
    expect(onUpdate).not.toHaveBeenCalled();
    callbacks[0](0);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(frame.doc);
  });

  it('counts a failed update, preserves prior state and skips the render pass', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new DocStore();
    store.docFor('chat:1').getMap('root').set('safe', 'existing');
    const onUpdate = vi.fn();
    store.onUpdate = onUpdate;

    expect(() => store.applyUpdateFrame({ doc: 'chat:1', update: 'not-base64%%%' })).not.toThrow();
    expect(store.docFor('chat:1').getMap('root').get('safe')).toBe('existing');
    expect(warning).toHaveBeenCalledOnce();
    expect(store.failedUpdateCount).toBe(1);
    expect(callbacks).toHaveLength(0);
    expect(onUpdate).not.toHaveBeenCalled();

    // 失败后仍可恢复：后续有效更新照常调度并触发渲染。
    const source = new Y.Doc();
    source.getMap('root').set('recovered', true);
    store.applyUpdateFrame({ doc: 'chat:1', update: bytesToBase64(Y.encodeStateAsUpdate(source)) });
    expect(callbacks).toHaveLength(1);
    callbacks[0](0);
    expect(onUpdate).toHaveBeenCalledWith('chat:1');
  });

  it('destroys cached identities and recreates an empty document after clear', () => {
    const store = new DocStore();
    const previous = store.docFor('session:1');
    previous.getMap('root').set('secret', 'projection');

    store.clear();
    const next = store.docFor('session:1');

    expect(next).not.toBe(previous);
    expect(next.getMap('root').has('secret')).toBe(false);
  });

  it('drop() destroys the identity and fences queued renders for that doc', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const store = new DocStore();
    const previous = store.docFor('session:1');
    previous.getMap('root').set('secret', 'projection');
    const onUpdate = vi.fn();
    store.onUpdate = onUpdate;
    store.applyUpdateFrame({ doc: 'session:1', update: bytesToBase64(Y.encodeStateAsUpdate(previous)) });
    expect(callbacks).toHaveLength(1);

    store.drop('session:1');

    // 身份已销毁：docFor 重建为空 doc。
    const next = store.docFor('session:1');
    expect(next).not.toBe(previous);
    expect(next.getMap('root').has('secret')).toBe(false);

    // drop 前已排队的旧 rAF 回调被拦截，不触发渲染。
    callbacks[0](0);
    expect(onUpdate).not.toHaveBeenCalled();

    // drop 后同一 docId 的新更新照常渲染（不残留旧标记）。
    const fresh = new Y.Doc();
    fresh.getMap('root').set('generation', 'fresh');
    store.applyUpdateFrame({ doc: 'session:1', update: bytesToBase64(Y.encodeStateAsUpdate(fresh)) });
    expect(callbacks).toHaveLength(2);
    callbacks[1](1);
    expect(onUpdate).toHaveBeenCalledWith('session:1');
  });

  it('fences queued renders from a cleared connection without consuming new work', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const source = new Y.Doc();
    source.getMap('root').set('generation', 'new');
    const frame = { doc: 'hub:registry', update: bytesToBase64(Y.encodeStateAsUpdate(source)) };
    const store = new DocStore();
    const onUpdate = vi.fn();
    store.onUpdate = onUpdate;

    store.applyUpdateFrame(frame);
    store.clear();
    store.applyUpdateFrame(frame);
    expect(callbacks).toHaveLength(2);

    callbacks[0](0);
    expect(onUpdate).not.toHaveBeenCalled();
    callbacks[1](1);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(store.docFor(frame.doc).getMap('root').get('generation')).toBe('new');
  });
});
