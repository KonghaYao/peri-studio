import { bytesToBase64 } from '@/shared/lib/base64';

export const MAX_TERMINAL_CHUNK_BYTES = 16 * 1024;
const MAX_TERMINAL_BASE64_BYTES = Math.ceil(MAX_TERMINAL_CHUNK_BYTES / 3) * 4;
export const TERMINAL_DIM_MIN = 2;
export const TERMINAL_DIM_MAX = 500;
const MAX_TERMINAL_ID_BYTES = 128;
const TERMINAL_ERROR_CODES = new Set([
  'forbidden',
  'invalid-request',
  'unavailable',
  'delivery-unknown',
  'limit-exceeded',
]);

export interface TerminalOpenedFrame {
  t: 'terminal_opened';
  requestId: string;
  terminalId: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalOutputFrame {
  t: 'terminal_output';
  terminalId: string;
  seq: number;
  data: string;
}

export interface TerminalExitFrame {
  t: 'terminal_exit';
  terminalId: string;
  exitCode?: number;
  signal?: string;
}

export interface TerminalErrorFrame {
  t: 'terminal_error';
  requestId?: string;
  terminalId?: string;
  code: 'forbidden' | 'invalid-request' | 'unavailable' | 'delivery-unknown' | 'limit-exceeded';
  message: string;
  retryable: boolean;
}

export type TerminalDownstreamFrame =
  | TerminalOpenedFrame
  | TerminalOutputFrame
  | TerminalExitFrame
  | TerminalErrorFrame;

export const terminalOpen = (
  requestId: string,
  projectId: string,
  cols: number,
  rows: number,
) => ({ t: 'terminal_open', requestId, projectId, cols, rows });

export const terminalInput = (terminalId: string, seq: number, data: string) => ({
  t: 'terminal_input',
  terminalId,
  seq,
  data,
});

export const terminalResize = (terminalId: string, cols: number, rows: number) => ({
  t: 'terminal_resize',
  terminalId,
  cols,
  rows,
});

export const terminalCloseByRequest = (requestId: string) => ({
  t: 'terminal_close',
  requestId,
});

export const terminalClose = (terminalId: string) => ({ t: 'terminal_close', terminalId });

/** xterm `onData` 是 UTF-16 string；TextEncoder 将其还原为 PTY UTF-8 输入字节。 */
export function encodeTerminalInput(data: string): string[] {
  return encodeBytes(new TextEncoder().encode(data));
}

/** xterm `onBinary` 每个 code unit 是一个原始 byte，不能再次做 UTF-8 编码。 */
export function encodeTerminalBinaryInput(data: string): string[] {
  const bytes = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) bytes[index] = data.charCodeAt(index) & 0xff;
  return encodeBytes(bytes);
}

function encodeBytes(bytes: Uint8Array): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += MAX_TERMINAL_CHUNK_BYTES) {
    chunks.push(bytesToBase64(bytes.subarray(offset, offset + MAX_TERMINAL_CHUNK_BYTES)));
  }
  return chunks;
}

export function clampTerminalDimension(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_DIM_MIN;
  return Math.min(TERMINAL_DIM_MAX, Math.max(TERMINAL_DIM_MIN, Math.trunc(value)));
}

export function decodeTerminalFrame(frame: Record<string, unknown>): TerminalDownstreamFrame | null {
  switch (frame.t) {
    case 'terminal_opened':
      return validId(frame.requestId)
        && validId(frame.terminalId)
        && typeof frame.cwd === 'string'
        && frame.cwd.length > 0
        && validDimension(frame.cols)
        && validDimension(frame.rows)
        ? frame as unknown as TerminalOpenedFrame
        : null;
    case 'terminal_output':
      return validId(frame.terminalId)
        && positiveSafeInteger(frame.seq)
        && strictBase64(frame.data)
        && decodedBase64Length(frame.data as string) <= MAX_TERMINAL_CHUNK_BYTES
        ? frame as unknown as TerminalOutputFrame
        : null;
    case 'terminal_exit':
      return validId(frame.terminalId)
        && optionalInteger(frame.exitCode)
        && optionalString(frame.signal)
        ? omitUndefined(frame, ['exitCode', 'signal']) as unknown as TerminalExitFrame
        : null;
    case 'terminal_error':
      return optionalId(frame.requestId)
        && optionalId(frame.terminalId)
        && typeof frame.code === 'string'
        && TERMINAL_ERROR_CODES.has(frame.code)
        && typeof frame.message === 'string'
        && typeof frame.retryable === 'boolean'
        ? omitUndefined(frame, ['requestId', 'terminalId']) as unknown as TerminalErrorFrame
        : null;
    default:
      return null;
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= MAX_TERMINAL_ID_BYTES;
}

const optionalId = (value: unknown): value is string | undefined => value == null || validId(value);
const optionalString = (value: unknown): value is string | undefined => value == null || typeof value === 'string';
const optionalInteger = (value: unknown): value is number | undefined => value == null || Number.isSafeInteger(value);
const validDimension = (value: unknown): value is number => Number.isSafeInteger(value)
  && Number(value) >= TERMINAL_DIM_MIN
  && Number(value) <= TERMINAL_DIM_MAX;
const positiveSafeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

function strictBase64(value: unknown): value is string {
  if (typeof value !== 'string'
    || value.length > MAX_TERMINAL_BASE64_BYTES
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try {
    atob(value);
    return true;
  } catch {
    return false;
  }
}

function decodedBase64Length(value: string): number {
  if (!value) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function omitUndefined(frame: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const normalized = { ...frame };
  for (const key of keys) {
    if (normalized[key] == null) delete normalized[key];
  }
  return normalized;
}
