// Composer / Quick Start 共用的口述开关。不 import store。

import { createSignal, onCleanup, onMount } from 'solid-js';
import { fetchVoiceCapability } from './capability';
import { startDictation, type DictationPorts, type DictationSession } from './dictation';

export function useDictation(ports: () => Pick<DictationPorts, 'getDraft' | 'setDraft'>) {
  const [available, setAvailable] = createSignal(false);
  const [listening, setListening] = createSignal(false);
  const [preview, setPreview] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  let session: DictationSession | null = null;

  onMount(() => {
    void fetchVoiceCapability().then((capability) => setAvailable(capability.enabled));
  });
  onCleanup(() => {
    session?.stop();
    session = null;
  });

  const toggle = () => {
    if (session) {
      session.stop();
      session = null;
      return;
    }
    if (!available()) return;
    setError(null);
    void startDictation(
      {
        getDraft: () => ports().getDraft(),
        setDraft: (text, nextPreview) => {
          ports().setDraft(text);
          setPreview(nextPreview ?? '');
        },
      },
      (state) => {
        setListening(state !== 'idle');
        if (state === 'idle') setPreview('');
      },
      (message) => {
        setError(message);
        session = null;
        setListening(false);
        setPreview('');
      },
    ).then((next) => {
      session = next;
    }).catch((err: unknown) => {
      session = null;
      setListening(false);
      setPreview('');
      setError(err instanceof Error ? err.message : 'Could not start voice input');
    });
  };

  return { available, listening, preview, error, toggle };
}
