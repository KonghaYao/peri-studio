import { WTerm } from '@wterm/dom';
import type { GhosttyCore } from '@wterm/ghostty';
import { createEffect, onCleanup, onMount } from 'solid-js';
import { cn } from '@/shared/lib/cn';
import { createGhosttyCore } from '@/shared/lib/wterm-ghostty';
import type { TerminalViewport } from '@/shared/lib/terminal-viewport';

export type { TerminalViewport } from '@/shared/lib/terminal-viewport';

export type TerminalProps = {
  class?: string;
  /** 浮窗隐藏停放时为 false，跳过 focus 但仍保持 WTerm 挂载。 */
  visible?: boolean;
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: (viewport: TerminalViewport) => void;
  onError?: (error: unknown) => void;
};

/** Solid 封装：@wterm/dom + @wterm/ghostty（https://wterm.dev/ghostty）。 */
export function Terminal(props: TerminalProps) {
  const isVisible = () => props.visible !== false;

  let host: HTMLDivElement | undefined;
  let term: WTerm | null = null;
  let core: GhosttyCore | null = null;
  let disposed = false;

  const buildViewport = (): TerminalViewport => ({
    write: (data) => {
      term?.write(data);
    },
    resize: (cols, rows) => {
      term?.resize(cols, rows);
    },
    focus: () => {
      term?.focus();
    },
    reset: () => {
      if (!term?.bridge) return;
      term.bridge.init(term.cols, term.rows);
    },
    get cols() {
      return term?.cols ?? 80;
    },
    get rows() {
      return term?.rows ?? 24;
    },
  });

  onMount(() => {
    void (async () => {
      if (!host || disposed) return;
      try {
        core = await createGhosttyCore();
        if (disposed || !host) {
          core.dispose();
          core = null;
          return;
        }
        term = new WTerm(host, {
          core,
          autoResize: true,
          cursorBlink: true,
          onData: (data) => props.onData?.(data),
          onResize: (cols, rows) => props.onResize?.(cols, rows),
        });
        await term.init();
        if (disposed) return;
        props.onReady?.(buildViewport());
        if (isVisible()) term.focus();
      } catch (error) {
        props.onError?.(error);
      }
    })();
  });

  createEffect(() => {
    if (!isVisible() || !term) return;
    term.focus();
  });

  onCleanup(() => {
    disposed = true;
    term?.destroy();
    term = null;
    core?.dispose();
    core = null;
  });

  return (
    <div
      ref={host}
      class={cn(
        'wterm-terminal-host relative min-h-0 flex-1 basis-0 overflow-hidden bg-terminal-viewport-bg',
        props.class,
      )}
      aria-label="Interactive terminal"
    />
  );
}
