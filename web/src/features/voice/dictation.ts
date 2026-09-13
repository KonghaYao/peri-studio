// 浏览器麦克风 → 同源 /voice 代理。features 不 import store。

import { joinDictation } from './pcm';
import { captureMicrophone, type MicCapture } from './mic-capture';
import { voiceSocketUrl } from './capability';

export type DictationState = 'idle' | 'starting' | 'listening';

export type DictationPorts = {
  getDraft: () => string;
  setDraft: (text: string) => void;
  socketUrl?: string;
  openSocket?: (url: string) => WebSocket;
  capture?: () => Promise<MicCapture>;
};

export type DictationSession = {
  stop: () => void;
};

export async function startDictation(
  ports: DictationPorts,
  onState: (state: DictationState) => void,
  onError: (message: string) => void,
): Promise<DictationSession> {
  onState('starting');
  let baseline = ports.getDraft();
  let socket: WebSocket | null = null;
  let mic: MicCapture | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      socket?.send(JSON.stringify({ type: 'session.finish' }));
    } catch {
      // socket may already be closed
    }
    socket?.close();
    mic?.stop();
    onState('idle');
  };

  try {
    socket = (ports.openSocket ?? ((url: string) => new WebSocket(url)))(
      ports.socketUrl ?? voiceSocketUrl(),
    );
    await waitOpen(socket);
    mic = await (ports.capture ?? captureMicrophone)((frame) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(frame);
    });
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let payload: { type?: string; text?: string; message?: string };
      try {
        payload = JSON.parse(event.data) as { type?: string; text?: string; message?: string };
      } catch {
        return;
      }
      if (payload.type === 'session.started') onState('listening');
      if (payload.type === 'transcript.partial' && payload.text) {
        ports.setDraft(joinDictation(baseline, payload.text));
      }
      if (payload.type === 'transcript.final' && payload.text) {
        baseline = joinDictation(baseline, payload.text);
        ports.setDraft(baseline);
      }
      if (payload.type === 'error') {
        onError(payload.message || 'Voice session failed');
        stop();
      }
      if (payload.type === 'session.finished') stop();
    };
    socket.onerror = () => {
      onError('Voice socket failed');
      stop();
    };
    socket.onclose = () => {
      if (!stopped) stop();
    };
    return { stop };
  } catch (error) {
    stop();
    onError(error instanceof Error ? error.message : 'Could not start dictation');
    throw error;
  }
}

function waitOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Voice socket failed')), { once: true });
  });
}
