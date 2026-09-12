import { createSignal, onCleanup, Show, type Accessor, type Component } from 'solid-js';
import { Button } from '@peri/ui';
import { Markdown } from '@/components/blocks';

export type StreamSpeed = 'normal' | 'fast';

export type StreamingReveal = {
  text: Accessor<string>;
  streaming: Accessor<boolean>;
  playing: Accessor<boolean>;
  complete: Accessor<boolean>;
  play: (speed?: StreamSpeed) => void;
  reset: () => void;
};

const STREAM_SPEED_PRESETS: Record<StreamSpeed, { chunkSize: number; intervalMs: number }> = {
  normal: { chunkSize: 4, intervalMs: 28 },
  // ~3× normal：仍明显快于 Stream，但留足时间观察流式解析与 Mermaid 前缀渲染。
  fast: { chunkSize: 10, intervalMs: 18 },
};

/** 逐字揭示文本，供 Markdown / Thinking 流式 demo 复用。 */
export function createStreamingReveal(
  source: string | Accessor<string>,
  options?: { chunkSize?: number; intervalMs?: number },
): StreamingReveal {
  const getSource = () => (typeof source === 'function' ? source() : source);
  const defaultChunkSize = options?.chunkSize ?? STREAM_SPEED_PRESETS.normal.chunkSize;
  const defaultIntervalMs = options?.intervalMs ?? STREAM_SPEED_PRESETS.normal.intervalMs;

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

  const play = (speed: StreamSpeed = 'normal') => {
    const full = getSource();
    if (!full) return;

    const preset = STREAM_SPEED_PRESETS[speed];
    const chunkSize = speed === 'normal' ? defaultChunkSize : preset.chunkSize;
    const intervalMs = speed === 'normal' ? defaultIntervalMs : preset.intervalMs;

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
  onPlayFast?: () => void;
  onReset: () => void;
  playLabel?: string;
  fastPlayLabel?: string;
};

export const StreamingControls: Component<StreamingControlsProps> = (props) => (
  <div class="flex flex-wrap items-center gap-8">
    <Button size="sm" variant="secondary" disabled={props.playing} onClick={props.onPlay}>
      {props.playLabel ?? 'Play stream'}
    </Button>
    <Show when={props.onPlayFast}>
      <Button size="sm" variant="secondary" disabled={props.playing} onClick={props.onPlayFast}>
        {props.fastPlayLabel ?? 'Fast stream'}
      </Button>
    </Show>
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
