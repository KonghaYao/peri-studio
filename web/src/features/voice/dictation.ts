// 浏览器麦克风 → 同源 /voice 代理。features 不 import store。

import { joinDictation, utteranceAlreadyCommitted } from './pcm';
import { captureMicrophone, type MicCapture } from './mic-capture';
import { voiceSocketUrl } from './capability';

export type DictationState = 'idle' | 'starting' | 'listening';

export type DictationPorts = {
  getDraft: () => string;
  /** preview 有值时 text 含中间态后缀；提交终稿时不传 preview。 */
  setDraft: (text: string, preview?: string) => void;
  socketUrl?: string;
  openSocket?: (url: string) => WebSocket;
  capture?: () => Promise<MicCapture>;
};

export type DictationSession = {
  stop: () => void;
};

const SETTLE_MS = 8_000;

export async function startDictation(
  ports: DictationPorts,
  onState: (state: DictationState) => void,
  onError: (message: string) => void,
): Promise<DictationSession> {
  onState('starting');
  let baseline = ports.getDraft();
  let preview = '';
  let socket: WebSocket | null = null;
  let mic: MicCapture | null = null;
  let stopped = false;
  let finishing = false;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

  const closeSession = () => {
    if (stopped) return;
    stopped = true;
    if (settleTimer !== undefined) clearTimeout(settleTimer);
    try {
      socket?.close();
    } catch {
      // socket may already be closed
    }
    mic?.stop();
    onState('idle');
  };

  const requestFinish = () => {
    if (stopped || finishing) return;
    finishing = true;
    try {
      socket?.send(JSON.stringify({ type: 'session.finish' }));
    } catch {
      // socket may already be closed
    }
    mic?.stop();
    settleTimer = setTimeout(closeSession, SETTLE_MS);
  };

  try {
    socket = (ports.openSocket ?? ((url: string) => new WebSocket(url)))(
      ports.socketUrl ?? voiceSocketUrl(),
    );
    await waitOpen(socket);
    onState('listening');
    mic = await (ports.capture ?? captureMicrophone)((frame) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(frame);
    });
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let payload: VoicePayload;
      try {
        payload = JSON.parse(event.data) as VoicePayload;
      } catch {
        return;
      }
      const text = payloadText(payload);
      if (payload.type === 'session.started') onState('listening');
      if (isPartial(payload.type) && text) {
        preview = text;
        ports.setDraft(joinDictation(baseline, preview), preview);
      } else if (isUtteranceFinal(payload.type) && text) {
        if (!utteranceAlreadyCommitted(baseline, text)) {
          baseline = joinDictation(baseline, text);
        }
        preview = '';
        ports.setDraft(baseline);
        if (finishing) closeSession();
      } else if (payload.type === 'result') {
        const incoming = text || preview;
        if (incoming && !utteranceAlreadyCommitted(baseline, incoming)) {
          baseline = joinDictation(baseline, incoming);
        }
        preview = '';
        ports.setDraft(baseline);
        if (finishing) closeSession();
      }
      if (payload.type === 'error') {
        onError(payload.message || payload.error?.message || 'Voice session failed');
        closeSession();
      }
      if (payload.type === 'session.finished') closeSession();
    };
    socket.onerror = () => {
      onError('Voice socket failed');
      closeSession();
    };
    socket.onclose = () => {
      if (!stopped) closeSession();
    };
    return { stop: requestFinish };
  } catch (error) {
    closeSession();
    onError(error instanceof Error ? error.message : 'Could not start dictation');
    throw error;
  }
}

type VoicePayload = {
  type?: string;
  text?: string;
  message?: string;
  result?: { transcript?: string; text?: string };
  error?: { message?: string };
};

function payloadText(payload: VoicePayload): string {
  const direct = payload.text?.trim();
  if (direct) return direct;
  return payload.result?.transcript?.trim() || payload.result?.text?.trim() || '';
}

function isPartial(type: string | undefined): boolean {
  return type === 'transcript.partial' || type === 'partial' || type === 'interim';
}

function isUtteranceFinal(type: string | undefined): boolean {
  return type === 'transcript.final' || type === 'final';
}

function waitOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Voice socket failed')), { once: true });
  });
}
