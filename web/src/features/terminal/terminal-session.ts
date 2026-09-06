import { createSignal, type Accessor } from 'solid-js';
import { base64ToBytes } from '@/shared/lib/base64';
import {
  clampTerminalDimension,
  encodeTerminalBinaryInput,
  encodeTerminalInput,
  terminalClose,
  terminalCloseByRequest,
  terminalInput,
  terminalOpen,
  terminalResize,
  type TerminalDownstreamFrame,
  type TerminalErrorFrame,
  type TerminalExitFrame,
  type TerminalOpenedFrame,
  type TerminalOutputFrame,
} from '@/shared/protocol/terminal';

export type TerminalPhase = 'idle' | 'opening' | 'running' | 'exited' | 'error' | 'closed';

export interface TerminalSessionState {
  phase: TerminalPhase;
  requestId: string | null;
  terminalId: string | null;
  projectId: string | null;
  projectName: string | null;
  cwd: string | null;
  error: string | null;
  retryable: boolean;
  exitCode: number | null;
  signal: string | null;
  cols: number | null;
  rows: number | null;
}

export interface TerminalOutputSink {
  write(data: Uint8Array): void | Promise<void>;
  reset(): void;
}

interface TerminalTransport {
  send(frame: unknown): boolean;
  ready(): boolean;
}

const initialState = (): TerminalSessionState => ({
  phase: 'idle',
  requestId: null,
  terminalId: null,
  projectId: null,
  projectName: null,
  cwd: null,
  error: null,
  retryable: false,
  exitCode: null,
  signal: null,
  cols: null,
  rows: null,
});

const MAX_BUFFERED_OUTPUT_BYTES = 1024 * 1024;
const MAX_BUFFERED_OUTPUT_CHUNKS = 1024;

/** 独立 PTY 会话状态机；不依赖 chat/Yjs/store，transport 由组合根注入。 */
export class TerminalSessionController {
  private readonly stateAccessor: Accessor<TerminalSessionState>;
  private readonly setState: (value: TerminalSessionState) => void;
  private transport: TerminalTransport | null = null;
  private sink: TerminalOutputSink | null = null;
  private nextInputSeq = 1;
  private expectedSeq = 1;
  private openingTerminalId: string | null = null;
  private bufferedOutput = new Map<number, Uint8Array>();
  private bufferedOutputBytes = 0;
  private sinkWritePending = false;
  private outputGeneration = 0;

  constructor() {
    const [state, setState] = createSignal(initialState());
    this.stateAccessor = state;
    this.setState = setState;
  }

  state(): TerminalSessionState {
    return this.stateAccessor();
  }

  installTransport(transport: TerminalTransport): void {
    this.transport = transport;
  }

  attachSink(sink: TerminalOutputSink): void {
    this.sink = sink;
    this.flushBufferedOutput();
  }

  detachSink(sink: TerminalOutputSink): void {
    if (this.sink !== sink) return;
    this.sink = null;
    this.outputGeneration += 1;
    this.sinkWritePending = false;
  }

  open(project: { id: string; name: string }, cols: number, rows: number): boolean {
    if (this.state().phase === 'opening' || this.state().phase === 'running') return false;
    if (!this.transport?.ready()) {
      this.setState({ ...initialState(), phase: 'error', error: 'Connection is not ready.', retryable: true });
      return false;
    }
    const requestId = crypto.randomUUID();
    this.nextInputSeq = 1;
    this.expectedSeq = 1;
    this.openingTerminalId = null;
    this.discardOutput();
    this.sink?.reset();
    this.setState({
      phase: 'opening',
      requestId,
      terminalId: null,
      projectId: project.id,
      projectName: project.name,
      cwd: null,
      error: null,
      retryable: false,
      exitCode: null,
      signal: null,
      cols: null,
      rows: null,
    });
    const sent = this.transport.send(terminalOpen(
      requestId,
      project.id,
      clampTerminalDimension(cols),
      clampTerminalDimension(rows),
    ));
    if (!sent) {
      this.setState({ ...this.state(), phase: 'error', error: 'Terminal open could not be sent.', retryable: true });
    }
    return sent;
  }

  input(data: string): void {
    this.sendInputChunks(encodeTerminalInput(data));
  }

  binaryInput(data: string): void {
    this.sendInputChunks(encodeTerminalBinaryInput(data));
  }

  resize(cols: number, rows: number): void {
    const current = this.state();
    if (current.phase !== 'running' || !current.terminalId) return;
    if (!this.transport?.send(terminalResize(
      current.terminalId,
      clampTerminalDimension(cols),
      clampTerminalDimension(rows),
    ))) {
      this.connectionLost();
    }
  }

  close(): void {
    const current = this.state();
    if (current.phase === 'idle' || current.phase === 'closed') return;
    const sent = this.sendCloseForCurrentSession();
    if (!sent && this.transport?.ready()) {
      this.setState({
        ...current,
        phase: 'error',
        error: 'Terminal close could not be sent.',
        retryable: true,
      });
      return;
    }
    if (!sent) return;
    this.nextInputSeq = 1;
    this.expectedSeq = 1;
    this.openingTerminalId = null;
    this.discardOutput();
    this.sink?.reset();
    this.setState({
      ...current,
      phase: 'closed',
      requestId: null,
      terminalId: null,
      error: null,
      retryable: false,
      exitCode: null,
      signal: null,
    });
  }

  /** WS 断开前尽力下发 terminal_close，不强制进入 closed 阶段。 */
  closeBeforeTeardown(): void {
    const phase = this.state().phase;
    if (phase === 'opening' || phase === 'running') {
      this.sendCloseForCurrentSession();
    }
  }

  connectionLost(): void {
    const current = this.state();
    if (current.phase !== 'opening' && current.phase !== 'running') return;
    this.openingTerminalId = null;
    this.discardOutput();
    this.setState({
      ...current,
      phase: 'error',
      error: 'Terminal disconnected. Start a new terminal after reconnecting.',
      retryable: true,
    });
  }

  reset(): void {
    this.nextInputSeq = 1;
    this.expectedSeq = 1;
    this.openingTerminalId = null;
    this.discardOutput();
    this.sink?.reset();
    this.setState(initialState());
  }

  handleFrame(frame: TerminalDownstreamFrame): void {
    switch (frame.t) {
      case 'terminal_opened':
        this.handleOpened(frame);
        break;
      case 'terminal_output':
        this.handleOutput(frame);
        break;
      case 'terminal_exit':
        this.handleExit(frame);
        break;
      case 'terminal_error':
        this.handleError(frame);
        break;
      default:
        break;
    }
  }

  private handleOpened(frame: TerminalOpenedFrame): void {
    const current = this.state();
    if (current.phase !== 'opening'
      || frame.requestId !== current.requestId) return;
    if (this.openingTerminalId && frame.terminalId !== this.openingTerminalId) {
      this.failProtocol('Terminal identity changed while opening.');
      return;
    }
    this.openingTerminalId = null;
    this.setState({
      ...current,
      phase: 'running',
      terminalId: frame.terminalId,
      cwd: frame.cwd,
      cols: frame.cols,
      rows: frame.rows,
    });
    this.flushBufferedOutput();
  }

  private handleOutput(frame: TerminalOutputFrame): void {
    const current = this.state();
    if (current.phase === 'opening') {
      if (this.openingTerminalId && frame.terminalId !== this.openingTerminalId) return;
      this.openingTerminalId ??= frame.terminalId;
    } else if (current.phase !== 'running' || frame.terminalId !== current.terminalId) {
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(frame.data);
    } catch {
      this.failProtocol('Terminal output could not be decoded.');
      return;
    }
    this.consumeOutput(frame.seq, bytes);
  }

  private consumeOutput(seq: number, bytes: Uint8Array): void {
    if (seq < this.expectedSeq) return;
    if (seq !== this.expectedSeq) {
      this.failProtocol('Terminal output sequence was interrupted.');
      return;
    }
    this.expectedSeq += 1;
    this.bufferOutput(seq, bytes);
    this.flushBufferedOutput();
  }

  private handleExit(frame: TerminalExitFrame): void {
    const current = this.state();
    if (frame.terminalId !== current.terminalId) return;
    this.setState({
      ...current,
      phase: 'exited',
      exitCode: frame.exitCode ?? null,
      signal: frame.signal ?? null,
    });
    this.flushBufferedOutput();
  }

  private handleError(frame: TerminalErrorFrame): void {
    const current = this.state();
    const ownsRequest = !!frame.requestId && frame.requestId === current.requestId;
    const ownsTerminal = !!frame.terminalId && (
      frame.terminalId === current.terminalId || frame.terminalId === this.openingTerminalId
    );
    if (!ownsRequest && !ownsTerminal) return;
    this.openingTerminalId = null;
    this.discardOutput();
    this.setState({
      ...current,
      phase: 'error',
      error: frame.message || 'Terminal failed.',
      retryable: frame.retryable,
    });
  }

  private failProtocol(message: string): void {
    const current = this.state();
    this.sendCloseForCurrentSession();
    this.openingTerminalId = null;
    this.discardOutput();
    this.setState({ ...current, phase: 'error', error: message, retryable: true });
  }

  private sendInputChunks(chunks: string[]): void {
    const current = this.state();
    if (current.phase !== 'running' || !current.terminalId) return;
    for (const data of chunks) {
      const seq = this.nextInputSeq;
      if (!this.transport?.send(terminalInput(current.terminalId, seq, data))) {
        this.connectionLost();
        return;
      }
      this.nextInputSeq += 1;
    }
  }

  private sendCloseForCurrentSession(): boolean {
    const current = this.state();
    const terminalId = current.terminalId ?? this.openingTerminalId;
    if (terminalId) {
      return this.transport?.send(terminalClose(terminalId)) ?? false;
    }
    if (current.phase === 'opening' && current.requestId) {
      return this.transport?.send(terminalCloseByRequest(current.requestId)) ?? false;
    }
    return true;
  }

  private bufferOutput(seq: number, bytes: Uint8Array): void {
    if (this.bufferedOutput.has(seq)) return;
    if (this.bufferedOutput.size >= MAX_BUFFERED_OUTPUT_CHUNKS
      || this.bufferedOutputBytes + bytes.byteLength > MAX_BUFFERED_OUTPUT_BYTES) {
      this.failProtocol('Terminal output buffer exceeded its limit.');
      return;
    }
    this.bufferedOutput.set(seq, bytes);
    this.bufferedOutputBytes += bytes.byteLength;
  }

  private flushBufferedOutput(): void {
    if (this.state().phase === 'opening'
      || !this.sink
      || this.sinkWritePending
      || this.bufferedOutput.size === 0) return;
    const next = this.bufferedOutput.entries().next().value as [number, Uint8Array] | undefined;
    if (!next) return;
    const [seq, bytes] = next;
    this.bufferedOutput.delete(seq);
    this.bufferedOutputBytes -= bytes.byteLength;
    const sink = this.sink;
    const generation = this.outputGeneration;
    let write: void | Promise<void>;
    try {
      write = sink.write(bytes);
    } catch {
      this.failProtocol('Terminal output could not be rendered.');
      return;
    }
    if (!write || typeof write.then !== 'function') {
      this.flushBufferedOutput();
      return;
    }
    this.sinkWritePending = true;
    void write.then(
      () => {
        if (generation !== this.outputGeneration) return;
        this.sinkWritePending = false;
        this.flushBufferedOutput();
      },
      () => {
        if (generation !== this.outputGeneration) return;
        this.sinkWritePending = false;
        this.failProtocol('Terminal output could not be rendered.');
      },
    );
  }

  private discardOutput(): void {
    this.outputGeneration += 1;
    this.sinkWritePending = false;
    this.bufferedOutput.clear();
    this.bufferedOutputBytes = 0;
  }
}

const terminalController = new TerminalSessionController();

export const terminalSession = (): TerminalSessionState => terminalController.state();
export const installTerminalTransport = (transport: TerminalTransport): void => terminalController.installTransport(transport);
export const attachTerminalOutput = (sink: TerminalOutputSink): void => terminalController.attachSink(sink);
export const detachTerminalOutput = (sink: TerminalOutputSink): void => terminalController.detachSink(sink);
export const openTerminal = (project: { id: string; name: string }, cols: number, rows: number): boolean => terminalController.open(project, cols, rows);
export const sendTerminalInput = (data: string): void => terminalController.input(data);
export const sendTerminalBinaryInput = (data: string): void => terminalController.binaryInput(data);
export const resizeTerminal = (cols: number, rows: number): void => terminalController.resize(cols, rows);
export const closeTerminal = (): void => terminalController.close();
export function handleTerminalFrame(frame: TerminalDownstreamFrame): void {
  terminalController.handleFrame(frame);
}
export const handleTerminalConnectionLost = (): void => terminalController.connectionLost();
export const closeTerminalBeforeTeardown = (): void => terminalController.closeBeforeTeardown();
export const resetTerminalSession = (): void => terminalController.reset();
