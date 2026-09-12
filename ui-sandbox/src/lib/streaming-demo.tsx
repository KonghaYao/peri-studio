import { createSignal, onCleanup, Show, type Accessor, type Component } from 'solid-js';
import { Button } from '@peri/ui';
import { Markdown } from '@/components/blocks';

export type StreamingReveal = {
  text: Accessor<string>;
  streaming: Accessor<boolean>;
  playing: Accessor<boolean>;
  complete: Accessor<boolean>;
  play: () => void;
  reset: () => void;
};

/** 逐字揭示文本，供 Markdown / Thinking 流式 demo 复用。 */
export function createStreamingReveal(
  source: string | Accessor<string>,
  options?: { chunkSize?: number; intervalMs?: number },
): StreamingReveal {
  const getSource = () => (typeof source === 'function' ? source() : source);
  const chunkSize = options?.chunkSize ?? 4;
  const intervalMs = options?.intervalMs ?? 28;

  const [text, setText] = createSignal('');
  const [playing, setPlaying] = createSignal(false);

  let timer: ReturnType<typeof setInterval> | undefined;

  const stopTimer = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const reset = () => {
    stopTimer();
    setText('');
    setPlaying(false);
  };

  const play = () => {
    const full = getSource();
    reset();
    if (!full) return;

    setPlaying(true);
    let index = 0;
    timer = setInterval(() => {
      index = Math.min(full.length, index + chunkSize);
      setText(full.slice(0, index));
      if (index >= full.length) {
        stopTimer();
        setPlaying(false);
      }
    }, intervalMs);
  };

  onCleanup(stopTimer);

  const streaming = () => playing() || (text().length > 0 && text().length < getSource().length);
  const complete = () => {
    const full = getSource();
    return full.length > 0 && text().length >= full.length;
  };

  return { text, streaming, playing, complete, play, reset };
}

/** 固定时长脉冲（Marker / Plan shimmer 等无文本流式场景）。 */
export function createPulseStream(durationMs = 2800) {
  const [active, setActive] = createSignal(false);
  const [finished, setFinished] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const reset = () => {
    stop();
    setActive(false);
    setFinished(false);
  };

  const play = () => {
    reset();
    setActive(true);
    timer = setTimeout(() => {
      setActive(false);
      setFinished(true);
      stop();
    }, durationMs);
  };

  onCleanup(stop);

  return {
    active,
    playing: active,
    complete: () => finished() && !active(),
    play,
    reset,
  };
}

type StreamingControlsProps = {
  playing: boolean;
  complete: boolean;
  onPlay: () => void;
  onReset: () => void;
  playLabel?: string;
};

export const StreamingControls: Component<StreamingControlsProps> = (props) => (
  <div class="flex flex-wrap items-center gap-8">
    <Button size="sm" variant="secondary" disabled={props.playing} onClick={props.onPlay}>
      {props.playLabel ?? 'Play stream'}
    </Button>
    <Button size="sm" variant="ghost" onClick={props.onReset}>Reset</Button>
    <Show when={props.playing}>
      <span class="text-12 text-content-muted">Streaming…</span>
    </Show>
    <Show when={props.complete && !props.playing}>
      <span class="text-12 text-content-muted">Complete</span>
    </Show>
  </div>
);

type StreamingMarkdownDemoProps = {
  source: string;
  class?: string;
};

export const StreamingMarkdownDemo: Component<StreamingMarkdownDemoProps> = (props) => {
  const reveal = createStreamingReveal(() => props.source);

  return (
    <>
      <StreamingControls
        playing={reveal.playing()}
        complete={reveal.complete()}
        onPlay={reveal.play}
        onReset={reveal.reset}
      />
      <Markdown source={reveal.text()} streaming={reveal.streaming()} class={props.class} />
    </>
  );
};
