import { beforeEach, describe, expect, it } from 'vitest';
import { createKeyedDelivery, createSingleSlotDelivery, type DeliveryEntry } from './delivery-state';

/**
 * 工厂契约测试：四个投递状态机（message / permission / runtime-control /
 * quick-start）此前各自手写的 transition + byCommand + remove 助手收敛为
 * 本模块的两种容器工厂。这里用最小桩条目覆盖全部契约行为；各状态机模块的
 * 行为断言仍保留在各自测试文件中（经工厂实现）。
 */
interface StubEntry extends DeliveryEntry {
  label: string;
}

const stub = (commandId: string, label: string, phase: DeliveryEntry['phase'] = 'sending'): StubEntry => ({
  commandId,
  label,
  phase,
  detail: null,
  retryable: true,
});

describe('createSingleSlotDelivery', () => {
  let current: StubEntry | null;
  let delivery: ReturnType<typeof createSingleSlotDelivery<StubEntry>>;

  const set = (entry: StubEntry | null) => { current = entry; };

  beforeEach(() => {
    current = null;
    delivery = createSingleSlotDelivery(() => current, set);
  });

  it('applies an update only to the exact matching command identity', () => {
    current = stub('cmd-a', 'alpha');
    expect(delivery.transition('other', (entry) => ({ ...entry, phase: 'failed' }))).toBe(false);
    expect(current?.phase).toBe('sending');
    expect(delivery.transition('cmd-a', (entry) => ({ ...entry, phase: 'uncertain', retryable: false }))).toBe(true);
    expect(current).toMatchObject({ commandId: 'cmd-a', phase: 'uncertain', retryable: false });
  });

  it('returns false on an empty slot and cannot resurrect a cleared entry', () => {
    expect(delivery.transition('cmd-a', (entry) => entry)).toBe(false);
    current = stub('cmd-a', 'alpha');
    set(null);
    expect(delivery.transition('cmd-a', (entry) => entry)).toBe(false);
  });

  it('preserves identity and payload through same-command updates', () => {
    current = stub('stable', 'payload');
    delivery.transition('stable', (entry) => ({ ...entry, phase: 'accepted', detail: null }));
    delivery.transition('stable', (entry) => ({ ...entry, phase: 'uncertain' }));
    delivery.transition('stable', (entry) => ({ ...entry, phase: 'sending', detail: null }));
    expect(current).toMatchObject({ commandId: 'stable', label: 'payload', phase: 'sending' });
  });
});

describe('createKeyedDelivery', () => {
  let entries: Map<string, StubEntry>;
  let delivery: ReturnType<typeof createKeyedDelivery<StubEntry, string>>;

  const set = (next: ReadonlyMap<string, StubEntry>) => { entries = new Map(next); };

  beforeEach(() => {
    entries = new Map();
    // 存储键与 commandId 分离：模拟 permissionId / chatId 语义。
    delivery = createKeyedDelivery(() => entries, set, (entry) => entry.label);
  });

  it('locates entries by command identity regardless of storage key', () => {
    entries.set('key-a', stub('cmd-a', 'key-a'));
    entries.set('key-b', stub('cmd-b', 'key-b'));
    expect(delivery.byCommand('cmd-a')).toMatchObject({ label: 'key-a' });
    expect(delivery.byCommand('cmd-b')).toMatchObject({ label: 'key-b' });
    expect(delivery.byCommand('missing')).toBeUndefined();
  });

  it('updates in place via the configured key extractor', () => {
    entries.set('perm-1', stub('allow-1', 'perm-1', 'pending'));
    entries.set('perm-2', stub('deny-2', 'perm-2', 'pending'));
    expect(delivery.transition('allow-1', (entry) => ({ ...entry, phase: 'uncertain' }))).toBe(true);
    expect(delivery.transition('missing', (entry) => entry)).toBe(false);
    expect(entries.get('perm-1')).toMatchObject({ commandId: 'allow-1', phase: 'uncertain' });
    expect(entries.get('perm-2')).toMatchObject({ phase: 'pending' });
    expect(entries.size).toBe(2);
  });

  it('removes by storage key and reports misses', () => {
    entries.set('chat-1', stub('cancel-1', 'chat-1'));
    expect(delivery.remove('chat-1')).toBe(true);
    expect(entries.size).toBe(0);
    expect(delivery.remove('chat-1')).toBe(false);
  });

  it('keeps unrelated entries independent under removal', () => {
    entries.set('chat-1', stub('cancel-1', 'chat-1'));
    entries.set('chat-2', stub('close-2', 'chat-2'));
    delivery.remove('chat-1');
    expect([...entries.keys()]).toEqual(['chat-2']);
    expect(delivery.byCommand('close-2')).toBeDefined();
  });

  it('fails closed on an empty container', () => {
    expect(delivery.byCommand('anything')).toBeUndefined();
    expect(delivery.transition('anything', (entry) => entry)).toBe(false);
    expect(delivery.remove('anything')).toBe(false);
  });
});
