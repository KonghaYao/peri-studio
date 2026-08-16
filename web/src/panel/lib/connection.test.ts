// 连接生命周期模块行为测试：状态回调驱动、epoch 隔离、重置与会话记忆。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient } from './ws-client';
import type { ConnDetail, ConnStatus, WsClientOpts } from './ws-client';
import {
  busy,
  connectWithCookie,
  connectionProblem,
  connectionReady,
  connState,
  disconnect,
  forgetRememberedSession,
  heartbeatCount,
  installConnection,
  promptDeliveryReady,
  readRememberedSession,
  rememberSession,
  resetConnectionState,
  setConnectionProblem,
} from './connection';

vi.mock('./ws-client', () => {
  class MockWsClient {
    static instances: { opts: Record<string, unknown> }[] = [];
    constructor(opts: Record<string, unknown>) {
      MockWsClient.instances.push({ opts });
    }
    connect(): void {}
    close(): void {}
    send(): boolean { return true; }
  }
  return { WsClient: MockWsClient };
});

function installTestDeps() {
  const deps = {
    settleConnectionLoss: vi.fn(),
    onConnectionLost: vi.fn(),
    onAuthInvalidation: vi.fn(),
    toast: vi.fn(),
    sendSubscribe: vi.fn(),
    onReady: vi.fn(),
    onFrame: vi.fn(),
    onProtocolIssue: vi.fn(),
  };
  installConnection(deps);
  return deps;
}

function lastClient(): { opts: Record<string, unknown> } {
  const instances = (WsClient as unknown as { instances: { opts: Record<string, unknown> }[] }).instances;
  return instances[instances.length - 1]!;
}

function emitStatus(state: ConnStatus, detail: ConnDetail = {}): void {
  (lastClient().opts.onStatus as (s: ConnStatus, d: ConnDetail) => void)(state, detail);
}

function emitStatusOn(client: { opts: Record<string, unknown> }, state: ConnStatus, detail: ConnDetail = {}): void {
  (client.opts.onStatus as (s: ConnStatus, d: ConnDetail) => void)(state, detail);
}

beforeEach(() => {
  (WsClient as unknown as { instances: unknown[] }).instances.length = 0;
});

afterEach(() => {
  resetConnectionState();
  vi.clearAllMocks();
});

describe('connection lifecycle', () => {
  it('connects and applies the ready transition from ws-client status', () => {
    const deps = installTestDeps();
    connectWithCookie();
    expect(busy()).toBe(true);
    expect(connectionProblem()).toBeNull();

    emitStatus('ready', { negotiatedCapabilities: ['prompt-delivery-v2'] });
    expect(connectionReady()).toBe(true);
    expect(promptDeliveryReady()).toBe(true);
    expect(connState()).toEqual({ text: 'Ready', kind: 'ok' });
    expect(deps.onReady).toHaveBeenCalled();

    emitStatus('heartbeat');
    expect(heartbeatCount()).toBe(1);
  });

  it('replaces connections are isolated by epoch so stale callbacks cannot mutate the new state', () => {
    const deps = installTestDeps();
    connectWithCookie();
    const first = lastClient();
    connectWithCookie();
    const second = lastClient();
    expect(second).not.toBe(first);

    emitStatusOn(first, 'ready');
    expect(deps.onReady).not.toHaveBeenCalled();
    emitStatusOn(second, 'ready');
    expect(deps.onReady).toHaveBeenCalledTimes(1);
    expect(connectionReady()).toBe(true);
  });
  it('forwards downstream frames and protocol issues through the injected callbacks', () => {
    const deps = installTestDeps();
    connectWithCookie();
    emitStatus('open');
    expect(deps.sendSubscribe).toHaveBeenCalledTimes(1);

    const frame = { t: 'ysync.update', doc: 'hub:registry', update: 'u' };
    const opts = lastClient().opts as unknown as WsClientOpts;
    opts.onFrame(frame as never);
    expect(deps.onFrame).toHaveBeenCalledWith(frame);
    opts.onProtocolIssue?.({ kind: 'non_text_frame', size: 4 });
    expect(deps.onProtocolIssue).toHaveBeenCalledWith({ kind: 'non_text_frame', size: 4 });
  });

  it('fatal 4502 invalidates authentication while other fatal codes toast', () => {
    const deps = installTestDeps();
    connectWithCookie();
    emitStatus('fatal', { code: 4502 });
    expect(deps.onAuthInvalidation).toHaveBeenCalledWith(expect.stringContaining('sign in again'));
    expect(deps.settleConnectionLoss).toHaveBeenCalled();
    expect(deps.onConnectionLost).toHaveBeenCalled();

    connectWithCookie();
    emitStatus('fatal', { code: 4500 });
    expect(deps.toast).toHaveBeenCalledWith(expect.stringContaining('instance offline'));
  });

  it('closed and reconnecting settle pending actions through the tracker callback', () => {
    const deps = installTestDeps();
    connectWithCookie();
    // connectWithCookie 内部已调用一次 settleConnectionLoss，先清零再数状态驱动次数。
    vi.clearAllMocks();
    emitStatus('reconnecting', { retryMs: 2000 });
    expect(deps.settleConnectionLoss).toHaveBeenCalledTimes(1);
    connectWithCookie();
    vi.clearAllMocks();
    emitStatus('closed');
    expect(deps.settleConnectionLoss).toHaveBeenCalledTimes(1);
    expect(deps.onConnectionLost).toHaveBeenCalledTimes(1);
    expect(busy()).toBe(false);
  });

  it('disconnect revokes readiness and notifies the composition root', () => {
    const deps = installTestDeps();
    connectWithCookie();
    emitStatus('ready', {});
    expect(connectionReady()).toBe(true);
    disconnect();
    expect(connectionReady()).toBe(false);
    expect(busy()).toBe(false);
    expect(deps.onConnectionLost).toHaveBeenCalled();
  });

  it('resetConnectionState restores every connection signal', () => {
    installTestDeps();
    connectWithCookie();
    setConnectionProblem({ code: 4501, title: 't', detail: 'd', action: 'reconnect' });
    emitStatus('heartbeat');
    emitStatus('heartbeat');
    resetConnectionState();
    expect(connState()).toEqual({ text: 'Disconnected', kind: 'idle' });
    expect(heartbeatCount()).toBe(0);
    expect(promptDeliveryReady()).toBe(false);
    expect(connectionProblem()).toBeNull();
  });
});

describe('remembered session', () => {
  it('round-trips the preferred session through localStorage', () => {
    installTestDeps();
    expect(readRememberedSession()).toBeNull();
    rememberSession('session-1');
    expect(readRememberedSession()).toBe('session-1');
    forgetRememberedSession();
    expect(readRememberedSession()).toBeNull();
  });
});
