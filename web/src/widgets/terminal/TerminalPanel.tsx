import { FolderRoot, PanelRightClose, Play, RotateCcw, SquareTerminal, X } from 'lucide-solid';
import { createEffect, createMemo, onCleanup, Show } from 'solid-js';
import { Badge, Button, IconButton, Status, Terminal, type TerminalViewport } from '@/shared/ui';
import {
  attachTerminalOutput,
  closeTerminal,
  detachTerminalOutput,
  openTerminal,
  resizeTerminal,
  sendTerminalInput,
  terminalSession,
  type TerminalOutputSink,
} from '@/features/terminal/terminal-session';
import { connectionReady, projectSessions, projects, readOnly, selectedSessionId } from '@/store';

/** 右侧浮动面板内的交互式 PTY；关闭面板仅隐藏，PTY 运行中不销毁终端视口。 */
export function TerminalPanel(props: { onClosePanel?: () => void; visible?: boolean } = {}) {
  const isVisible = () => props.visible !== false;
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

  let viewportHost: HTMLDivElement | undefined;
  let viewport: TerminalViewport | null = null;

  const outputSink: TerminalOutputSink = {
    write: (data) => {
      const result = viewport?.write(data);
      return result instanceof Promise ? result : Promise.resolve();
    },
    reset: () => viewport?.reset(),
  };

  const syncPtySize = (notifyServer: boolean) => {
    if (!viewport) return;
    if (notifyServer) resizeTerminal(viewport.cols, viewport.rows);
  };

  /** 浮动面板 flex 布局完成前 host 常为 0×0；过早 open 会把 PTY 开成极小列数。 */
  const scheduleWhenSized = (notifyServer: boolean, after?: () => void) => {
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      if (!viewportHost || !viewport) {
        if (attempts < 40) requestAnimationFrame(tick);
        return;
      }
      const { clientWidth, clientHeight } = viewportHost;
      if (clientWidth < 16 || clientHeight < 16) {
        if (attempts < 40) requestAnimationFrame(tick);
        return;
      }
      syncPtySize(notifyServer);
      after?.();
    };
    requestAnimationFrame(tick);
  };

  const bindViewport = (next: TerminalViewport) => {
    viewport = next;
    attachTerminalOutput(outputSink);
    if (isVisible()) {
      scheduleWhenSized(terminalSession().phase === 'running');
    }
  };

  const start = () => {
    const project = activeProject();
    if (!project || readOnly() || !connectionReady()) return;
    if (terminalSession().phase !== 'idle' && terminalSession().phase !== 'closed') closeTerminal();
    scheduleWhenSized(false, () => {
      if (!viewport) return;
      openTerminal(project, viewport.cols, viewport.rows);
      viewport.focus();
    });
  };

  createEffect(() => {
    if (!isVisible() || !viewport) return;
    const phase = terminalSession().phase;
    scheduleWhenSized(phase === 'running', () => {
      if (phase === 'running') viewport?.focus();
    });
  });

  onCleanup(() => {
    detachTerminalOutput(outputSink);
    viewport = null;
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
    <section aria-label="Terminal" class="flex min-h-0 min-w-0 flex-1 basis-0 flex-col bg-terminal-dock-surface">
      <header class="flex h-(--terminal-header-height) min-w-0 shrink-0 items-center gap-6 border-b border-border-subtle px-8">
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
        <Show when={state().phase === 'opening' || state().phase === 'running'}>
          <IconButton label="Close terminal" size="sm" showTooltip={false} onClick={closeTerminal}>
            <X size={14} aria-hidden="true" />
          </IconButton>
        </Show>
        <Show when={props.onClosePanel}>
          <IconButton label="Close panel" size="sm" showTooltip={false} onClick={() => props.onClosePanel?.()}>
            <PanelRightClose size={14} aria-hidden="true" />
          </IconButton>
        </Show>
      </header>

      <Show when={state().phase === 'error'}>
        <div role="alert" class="shrink-0 border-b border-danger-border bg-danger-soft px-10 py-6 text-11 text-danger">
          {state().error ?? 'Terminal unavailable.'}
        </div>
      </Show>

      <div
        ref={viewportHost}
        class="flex min-h-0 flex-1 basis-0 flex-col p-8 focus-within:outline-1 focus-within:outline-focus-ring focus-within:outline-offset--1"
      >
        <Terminal
          visible={isVisible()}
          onData={sendTerminalInput}
          onResize={(cols, rows) => resizeTerminal(cols, rows)}
          onReady={bindViewport}
        />
      </div>
    </section>
  );
}
