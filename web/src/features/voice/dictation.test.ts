import { describe, expect, it, vi } from 'vitest';
import { startDictation } from './dictation';

class FakeSocket {
  readyState = 0;
  sent: Array<string | Uint8Array> = [];
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private readonly listeners = new Map<string, Array<(event?: Event) => void>>();

  addEventListener(type: string, handler: (event?: Event) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  open() {
    this.readyState = 1;
    for (const handler of this.listeners.get('open') ?? []) handler();
  }

  send(data: string | Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(data: string) {
    this.onmessage?.({ data } as MessageEvent<string>);
  }
}

describe('startDictation', () => {
  it('appends partial then final text without touching store', async () => {
    let draft = 'hello';
    const socket = new FakeSocket();
    const stopMic = vi.fn();
    const session = await startDictation(
      {
        getDraft: () => draft,
        setDraft: (text) => {
          draft = text;
        },
        socketUrl: 'ws://127.0.0.1/voice',
        openSocket: () => {
          queueMicrotask(() => socket.open());
          return socket as unknown as WebSocket;
        },
        capture: async () => ({ stop: stopMic }),
      },
      () => {},
      () => {},
    );
    socket.emit(JSON.stringify({ type: 'transcript.partial', text: 'world' }));
    expect(draft).toBe('hello world');
    socket.emit(JSON.stringify({ type: 'transcript.final', text: 'world' }));
    expect(draft).toBe('hello world');
    session.stop();
    expect(socket.sent).toContain(JSON.stringify({ type: 'session.finish' }));
    expect(stopMic).toHaveBeenCalled();
  });
});
