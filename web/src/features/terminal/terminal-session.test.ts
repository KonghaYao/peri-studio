import { describe, expect, it, vi } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '@/shared/lib/base64';
import { TerminalSessionController, type TerminalOutputSink } from './terminal-session';

function harness(options: { attachSink?: boolean } = {}) {
  const controller = new TerminalSessionController();
  const sent: unknown[] = [];
  const written: Uint8Array[] = [];
  const sink: TerminalOutputSink = {
    write: (data) => { written.push(data); },
    reset: vi.fn(),
  };
  controller.installTransport({
    ready: () => true,
    send: (frame) => { sent.push(frame); return true; },
  });
  if (options.attachSink !== false) controller.attachSink(sink);
  return { controller, sent, written, sink };
}

const project = { id: 'project-1', name: 'Peri' };
const terminalId = 'terminal-1';
const encoded = (text: string) => bytesToBase64(new TextEncoder().encode(text));

function beginOpen(controller: TerminalSessionController) {
  expect(controller.open(project, 80, 24)).toBe(true);
  return { requestId: controller.state().requestId!, terminalId };
}

function opened(requestId: string) {
  return {
    t: 'terminal_opened' as const,
    requestId,
    terminalId,
    cwd: '/trusted/project',
    cols: 100,
    rows: 30,
  };
}

const decodeWritten = (written: Uint8Array[]) => written.map((chunk) => new TextDecoder().decode(chunk));

async function nextMicrotask(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('TerminalSessionController', () => {
  it('buffers ordered output that races ahead of opened', () => {
    const { controller, written } = harness();
    const ids = beginOpen(controller);

    controller.handleFrame({ t: 'terminal_output', terminalId, seq: 1, data: encoded('one') });
    controller.handleFrame({ t: 'terminal_output', terminalId, seq: 2, data: encoded('two') });
    expect(written).toHaveLength(0);

    controller.handleFrame(opened(ids.requestId));
    expect(controller.state()).toMatchObject({
      phase: 'running',
      terminalId,
      cwd: '/trusted/project',
      cols: 100,
      rows: 30,
    });
    expect(decodeWritten(written)).toEqual(['one', 'two']);
  });

  it('rejects an opened identity that differs from early output', () => {
    const { controller, sent } = harness();
    const ids = beginOpen(controller);
    controller.handleFrame({ t: 'terminal_output', terminalId, seq: 1, data: encoded('one') });
    controller.handleFrame({ ...opened(ids.requestId), terminalId: 'terminal-2' });

    expect(controller.state()).toMatchObject({ phase: 'error', retryable: true });
    expect(sent.at(-1)).toEqual({ t: 'terminal_close', terminalId });
  });

  it('ignores duplicate output and fails closed on a sequence gap', () => {
    const { controller, sent, written } = harness();
    const ids = beginOpen(controller);
    controller.handleFrame(opened(ids.requestId));
    controller.handleFrame({ t: 'terminal_output', terminalId, seq: 1, data: encoded('one') });
    controller.handleFrame({ t: 'terminal_output', terminalId, seq: 1, data: encoded('duplicate') });
    controller.handleFrame({ t: 'terminal_output', terminalId, seq: 3, data: encoded('gap') });

    expect(decodeWritten(written)).toEqual(['one']);
    expect(controller.state()).toMatchObject({ phase: 'error', retryable: true });
    expect(sent.at(-1)).toEqual({ t: 'terminal_close', terminalId });
  });

  it('serializes asynchronous sink writes', async () => {
    const controller = new TerminalSessionController();
    const calls: string[] = [];
    const resolvers: Array<() => void> = [];
    controller.installTransport({ ready: () => true, send: () => true });
    controller.attachSink({
      write: (data) => new Promise<void>((resolve) => {
        calls.push(new TextDecoder().decode(data));
        resolvers.push(resolve);
      }),
      reset: vi.fn(),
    });
    const ids = beginOpen(controller);
    controller.handleFrame(opened(ids.requestId));

    controller.handleFrame({ t: 'terminal_output', terminalId, seq: 1, data: encoded('one') });
    controller.handleFrame({ t: 'terminal_output', terminalId, seq: 2, data: encoded('two') });
    expect(calls).toEqual(['one']);

    resolvers.shift()!();
    await nextMicrotask();
    expect(calls).toEqual(['one', 'two']);
    resolvers.shift()!();
  });

  it('fails closed when detached output exceeds the bounded buffer', () => {
    const { controller, sent } = harness({ attachSink: false });
    const ids = beginOpen(controller);
    controller.handleFrame(opened(ids.requestId));
    const chunk = bytesToBase64(new Uint8Array(16 * 1024));
    for (let seq = 1; seq <= 65; seq += 1) {
      controller.handleFrame({ t: 'terminal_output', terminalId, seq, data: chunk });
    }

    expect(controller.state()).toMatchObject({
      phase: 'error',
      error: 'Terminal output buffer exceeded its limit.',
    });
    expect(sent.at(-1)).toEqual({ t: 'terminal_close', terminalId });
  });

  it('uses monotonic input sequence numbers and bounded UTF-8 chunks', () => {
    const { controller, sent } = harness();
    const ids = beginOpen(controller);
    controller.handleFrame(opened(ids.requestId));
    controller.input('界'.repeat(12_000));

    const inputs = sent.filter((frame): frame is { t: string; seq: number; data: string } => (
      typeof frame === 'object' && frame !== null && (frame as { t?: string }).t === 'terminal_input'
    ));
    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs.map((frame) => frame.seq)).toEqual(inputs.map((_, index) => index + 1));
    expect(inputs.every((frame) => base64ToBytes(frame.data).byteLength <= 16 * 1024)).toBe(true);
  });

  it('sends clamped resize dimensions for the authoritative terminal id', () => {
    const { controller, sent } = harness();
    const ids = beginOpen(controller);
    controller.handleFrame(opened(ids.requestId));
    controller.resize(999, 1);
    expect(sent.at(-1)).toEqual({
      t: 'terminal_resize',
      terminalId,
      cols: 500,
      rows: 2,
    });
  });

  it('closes a pending open by request id and surfaces the closed state', () => {
    const { controller, sent } = harness();
    const ids = beginOpen(controller);
    controller.close();

    expect(sent.at(-1)).toEqual({ t: 'terminal_close', requestId: ids.requestId });
    expect(controller.state()).toMatchObject({ phase: 'closed', terminalId: null, requestId: null });
  });

  it('marks a live terminal unavailable on connection loss without reopening it', () => {
    const { controller } = harness();
    const ids = beginOpen(controller);
    controller.handleFrame(opened(ids.requestId));
    controller.connectionLost();
    expect(controller.state()).toMatchObject({ phase: 'error', terminalId, retryable: true });
  });

  it('stays running when close frame cannot be sent while transport is ready', () => {
    const { controller, sent } = harness();
    const ids = beginOpen(controller);
    controller.handleFrame(opened(ids.requestId));
    let allowSend = true;
    controller.installTransport({
      ready: () => true,
      send: (frame) => {
        sent.push(frame);
        return allowSend;
      },
    });
    allowSend = false;
    controller.close();
    expect(sent.at(-1)).toEqual({ t: 'terminal_close', terminalId });
    expect(controller.state()).toMatchObject({
      phase: 'error',
      terminalId,
      error: 'Terminal close could not be sent.',
      retryable: true,
    });
  });

  it('sends close on teardown without entering closed phase', () => {
    const { controller, sent } = harness();
    const ids = beginOpen(controller);
    controller.handleFrame(opened(ids.requestId));
    controller.closeBeforeTeardown();
    expect(sent.at(-1)).toEqual({ t: 'terminal_close', terminalId });
    expect(controller.state()).toMatchObject({ phase: 'running', terminalId });
  });
});
