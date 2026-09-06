import { FitAddon } from '@xterm/addon-fit';
import { ImageAddon } from '@xterm/addon-image';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import { createEffect, onCleanup, onMount } from 'solid-js';
import { cn } from '@/shared/lib/cn';
import { openTerminalWebLink } from '@/shared/lib/terminal-web-link';
import { readXtermFontFamily, readXtermTheme } from '@/shared/lib/xterm-theme';
import type { TerminalViewport } from '@/shared/lib/terminal-viewport';

export type { TerminalViewport } from '@/shared/lib/terminal-viewport';

export type TerminalProps = {
  class?: string;
  /** 浮窗隐藏停放时为 false，跳过 fit/focus 但仍保持 xterm 挂载。 */
  visible?: boolean;
  onData?: (data: string) => void;
  onBinary?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: (viewport: TerminalViewport) => void;
  onError?: (error: unknown) => void;
};

const MIN_HOST_EDGE_PX = 16;

/** Solid 封装：xterm.js + Fit / Image / WebLinks（复制粘贴走浏览器选区 + 核心 onData）。 */
export function Terminal(props: TerminalProps) {
  const isVisible = () => props.visible !== false;

  let host: HTMLDivElement | undefined;
  let xterm: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  let imageAddon: ImageAddon | null = null;
  let webLinksAddon: WebLinksAddon | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let inputDisposable: { dispose(): void } | null = null;
  let binaryDisposable: { dispose(): void } | null = null;
  let wasVisible = false;
  let readySent = false;

  const hostSized = () => {
    if (!host) return false;
    const { clientWidth, clientHeight } = host;
    return clientWidth >= MIN_HOST_EDGE_PX && clientHeight >= MIN_HOST_EDGE_PX;
  };

  const fit = (notifyServer: boolean) => {
    if (!xterm || !fitAddon || !isVisible() || !hostSized()) return;
    try {
      fitAddon.fit();
      if (notifyServer) props.onResize?.(xterm.cols, xterm.rows);
    } catch {
      // 停放或布局未完成时稍后重试
    }
  };

  const buildViewport = (): TerminalViewport => ({
    write: (data) =>
      new Promise<void>((resolve) => {
        if (!xterm) {
          resolve();
          return;
        }
        if (typeof data === 'string') {
          xterm.write(data, resolve);
        } else {
          xterm.write(data, resolve);
        }
      }),
    resize: (cols, rows) => {
      xterm?.resize(cols, rows);
    },
    fit: () => fit(true),
    focus: () => {
      xterm?.focus();
    },
    reset: () => {
      xterm?.reset();
      imageAddon?.reset();
    },
    get cols() {
      return xterm?.cols ?? 80;
    },
    get rows() {
      return xterm?.rows ?? 24;
    },
  });

  const ensureXterm = () => {
    if (xterm || !host || !hostSized()) return;
    try {
      xterm = new XTerm({
        allowProposedApi: true,
        cursorBlink: true,
        scrollback: 5000,
        rightClickSelectsWord: true,
        fontFamily: readXtermFontFamily(),
        fontSize: 12,
        lineHeight: 1.35,
        drawBoldTextInBrightColors: true,
        /** 关闭对比度强制调整，保留 truecolor / 256 色输出 */
        minimumContrastRatio: 1,
        theme: readXtermTheme(),
      });
      fitAddon = new FitAddon();
      imageAddon = new ImageAddon({
        sixelSupport: true,
        sixelScrolling: true,
        sixelPaletteLimit: 256,
        iipSupport: true,
        enableSizeReports: true,
      });
      webLinksAddon = new WebLinksAddon(openTerminalWebLink);
      xterm.loadAddon(fitAddon);
      xterm.loadAddon(imageAddon);
      xterm.loadAddon(webLinksAddon);
      xterm.open(host);
      inputDisposable = xterm.onData((data) => props.onData?.(data));
      binaryDisposable = xterm.onBinary((data) => props.onBinary?.(data));
      fit(false);
      if (!readySent) {
        readySent = true;
        props.onReady?.(buildViewport());
      }
      if (isVisible()) xterm.focus();
    } catch (error) {
      props.onError?.(error);
    }
  };

  onMount(() => {
    resizeObserver = new ResizeObserver(() => {
      ensureXterm();
      fit(true);
    });
    if (host) resizeObserver.observe(host);
    ensureXterm();
  });

  createEffect(() => {
    const visible = isVisible();
    if (visible) {
      ensureXterm();
      fit(true);
    }
    if (visible && !wasVisible && xterm) xterm.focus();
    wasVisible = visible;
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    inputDisposable?.dispose();
    binaryDisposable?.dispose();
    webLinksAddon?.dispose();
    imageAddon?.dispose();
    xterm?.dispose();
    xterm = null;
    fitAddon = null;
    imageAddon = null;
    webLinksAddon = null;
  });

  return (
    <div
      ref={host}
      class={cn(
        'terminal-xterm-host relative min-h-0 flex-1 basis-0 overflow-hidden bg-terminal-viewport-bg',
        props.class,
      )}
      aria-label="Interactive terminal"
    />
  );
}
