import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ChevronDown, ChevronUp, FolderRoot, Play, RotateCcw, SquareTerminal, X } from 'lucide-solid';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { Badge, Button, IconButton, Status } from '@/shared/ui';
import {
  attachTerminalOutput,
  closeTerminal,
  detachTerminalOutput,
  openTerminal,
  resizeTerminal,
  sendTerminalBinaryInput,
  sendTerminalInput,
  terminalSession,
  type TerminalOutputSink,
} from '@/features/terminal/terminal-session';
import { connectionReady, projectSessions, projects, readOnly, selectedSessionId } from '@/store';

function cssValue(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function TerminalDock() {
  const [expanded, setExpanded] = createSignal(false);
  const activeProject = createMemo(() => {
    const session = projectSessions().find((item) => item.id === selectedSessionId());
    return projects().find((item) => item.id === session?.projectId && !item.archivedAt) ?? null;
  });
  const boundProject = createMemo(() => {
    const session = terminalSession();
    if (session.projectId) {
      return {
        id: session.projectId,
        name: session.projectName ?? session.projectId,
        cwd: session.cwd ?? '',
      };
    }
    return activeProject();
  });
  const statusMeta = createMemo(() => {
    switch (terminalSession().phase) {
      case 'opening': return { label: 'Opening', tone: 'info' as const, live: true };
      case 'running': return { label: 'Running', tone: 'success' as const, live: true };
      case 'exited': return { label: 'Exited', tone: 'neutral' as const, live: false };
      case 'error': return { label: 'Error', tone: 'danger' as const, live: false };
      case 'closed': return { label: 'Closed', tone: 'neutral' as const, live: false };
      default: return { label: 'Idle', tone: 'neutral' as const, live: false };
    }
  });
  let host: HTMLDivElement | undefined;
  let xterm: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let inputDisposable: { dispose(): void } | null = null;
  let binaryDisposable: { dispose(): void } | null = null;

  const outputSink: TerminalOutputSink = {
    write: (data) => new Promise<void>((resolve) => {
      if (!xterm) {
        resolve();
        return;
      }
      xterm.write(data, resolve);
    }),
    reset: () => xterm?.reset(),
  };

  const fit = (notify = true) => {
    if (!xterm || !fitAddon || !expanded()) return;
    try {
      fitAddon.fit();
      if (notify) resizeTerminal(xterm.cols, xterm.rows);
    } catch {
      // Hidden or detached layouts are retried on the next expand/resize.
    }
  };

  const ensureXterm = () => {
    if (xterm || !host) return;
    xterm = new Terminal({
      cursorBlink: true,
      fontFamily: cssValue('--font-mono', 'monospace'),
      fontSize: 12,
      lineHeight: 1.35,
      screenReaderMode: true,
      scrollback: 5000,
      theme: {
        background: cssValue('--terminal-viewport-bg', '#141414'),
        foreground: cssValue('--terminal-viewport-fg', '#f0f0f0'),
        cursor: cssValue('--terminal-viewport-accent', '#60a5fa'),
        selectionBackground: 'rgba(96, 165, 250, 0.3)',
      },
    });
    fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(host);
    inputDisposable = xterm.onData(sendTerminalInput);
    binaryDisposable = xterm.onBinary(sendTerminalBinaryInput);
    attachTerminalOutput(outputSink);
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => fit());
      resizeObserver.observe(host);
    }
  };

  const toggleExpanded = () => {
    const next = !expanded();
    setExpanded(next);
    if (next) {
      ensureXterm();
      queueMicrotask(() => {
        fit();
        xterm?.focus();
      });
    }
  };

  const start = () => {
    const project = activeProject();
    if (!project || readOnly() || !connectionReady()) return;
    if (terminalSession().phase !== 'idle') closeTerminal();
    setExpanded(true);
    ensureXterm();
    queueMicrotask(() => {
      fit(false);
      openTerminal(project, xterm?.cols ?? 80, xterm?.rows ?? 24);
      xterm?.focus();
    });
  };

  createEffect(() => {
    const session = terminalSession();
    if (session.phase !== 'running' || !xterm || session.cols === null || session.rows === null) return;
    xterm.resize(session.cols, session.rows);
  });

  onCleanup(() => {
    closeTerminal();
    detachTerminalOutput(outputSink);
    resizeObserver?.disconnect();
    inputDisposable?.dispose();
    binaryDisposable?.dispose();
    xterm?.dispose();
  });

  const state = terminalSession;
  const startDisabled = () => !activeProject() || readOnly() || !connectionReady() || state().phase === 'opening';
  const startLabel = () => state().phase === 'idle' || state().phase === 'closed' ? 'Start terminal' : 'Restart terminal';
  const terminalDescription = () => {
    if (!activeProject()) return 'Select a project session to start a terminal.';
    if (readOnly()) return 'Terminal access requires write permission.';
    if (!connectionReady()) return 'Connect to start a terminal.';
    return 'Starts a shell in the selected project.';
  };

  return (
    <section aria-label="Terminal dock" class="shrink-0 border-t border-terminal-dock-border bg-terminal-dock-surface">
      <header class="flex h-(--terminal-header-height) min-w-0 items-center gap-6 border-b border-border-subtle px-8">
        <IconButton
          label={expanded() ? 'Collapse terminal viewport' : 'Expand terminal viewport'}
          size="sm"
          showTooltip={false}
          onClick={toggleExpanded}
        >
          {expanded() ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
        </IconButton>
        <SquareTerminal size={14} class="shrink-0 text-text-muted" aria-hidden="true" />
        <span class="truncate text-12 font-medium text-text-primary">Terminal</span>
        <Show when={boundProject()}>
          {(project) => (
            <span class="inline-flex min-w-0 items-center gap-4 truncate text-11 text-text-muted max-compact:hidden" title="Terminal stays bound to the project where it was created">
              <FolderRoot size={12} class="shrink-0" aria-hidden="true" />
              <span class="truncate">Bound to {project().name}</span>
            </span>
          )}
        </Show>
        <Show when={state().cwd}>
          <Badge tone="neutral" class="max-compact:hidden">{state().cwd}</Badge>
        </Show>
        <span class="flex-1" />
        <Status tone={statusMeta().tone} live={statusMeta().live} class="shrink-0">{statusMeta().label}</Status>
        <Show when={state().phase === 'idle' || state().phase === 'closed'}>
          <Button size="sm" variant="ghost" disabled={startDisabled()} title={terminalDescription()} onClick={start}>
            <Play size={13} aria-hidden="true" /> Start
          </Button>
        </Show>
        <Show when={state().phase === 'exited' || state().phase === 'error'}>
          <IconButton label={startLabel()} size="sm" showTooltip={false} disabled={startDisabled()} onClick={start}>
            <RotateCcw size={14} aria-hidden="true" />
          </IconButton>
        </Show>
        <Show when={state().phase !== 'idle' && state().phase !== 'closed'}>
          <IconButton label="Close terminal" size="sm" showTooltip={false} onClick={closeTerminal}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </Show>
      </header>

      <div class={expanded() ? 'block' : 'hidden'}>
        <Show when={state().phase === 'error'}>
          <div role="alert" class="border-b border-danger-border bg-danger-soft px-10 py-6 text-11 text-danger">
            {state().error ?? 'Terminal failed.'}
          </div>
        </Show>
        <Show when={state().phase === 'exited'}>
          <div role="status" class="border-b border-border-subtle bg-surface-muted px-10 py-6 text-11 text-text-secondary">
            Terminal exited{state().exitCode !== null ? ` with code ${state().exitCode}` : ''}{state().signal ? ` (${state().signal})` : ''}.
          </div>
        </Show>
        <div
          ref={host}
          class="terminal-xterm-host h-(--terminal-viewport-height) overflow-hidden bg-terminal-viewport-bg p-8 focus-within:outline-1 focus-within:outline-focus-ring focus-within:outline-offset--1"
          aria-label="Interactive terminal"
        />
      </div>
    </section>
  );
}
