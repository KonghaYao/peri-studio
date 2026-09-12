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

  // 默认展示完整内容；Play 从空串重新逐字揭示，Reset 恢复完整静态视图。
  const [text, setText] = createSignal(getSource());
  const [playing, setPlaying] = createSignal(false);
  const [streamCycleDone, setStreamCycleDone] = createSignal(false);

  let timer: ReturnType<typeof setInterval> | undefined;

  const stopTimer = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const reset = () => {
    stopTimer();
    setText(getSource());
    setPlaying(false);
    setStreamCycleDone(false);
  };

  const play = () => {
    const full = getSource();
    if (!full) return;

    stopTimer();
    setText('');
    setPlaying(true);
    setStreamCycleDone(false);

    let index = 0;
    const tick = () => {
      index = Math.min(full.length, index + chunkSize);
      setText(full.slice(0, index));
      if (index >= full.length) {
        stopTimer();
        setPlaying(false);
        setStreamCycleDone(true);
      }
    };

    tick();
    timer = setInterval(tick, intervalMs);
  };

  onCleanup(stopTimer);

  const streaming = () => playing();
  const complete = () => streamCycleDone() && !playing();

  return { text, streaming, playing, complete, play, reset };
}

/** 固定时长脉冲（Plan shimmer 等无文本流式场景）。 */
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
      <Markdown source={reveal.text} streaming={reveal.streaming()} class={props.class} />
    </>
  );
};
