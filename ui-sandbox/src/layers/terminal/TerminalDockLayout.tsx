import { createSignal, Show } from 'solid-js';
import { Button, IconButton, InlineNotice, Status } from '@/lib/catalog-ui';
import { ChevronDown, ChevronUp, FolderRoot, Terminal } from 'lucide-solid';

/** 沙箱演示：PTY 生命周期，无后端。 */
type TerminalLifecycle = 'running' | 'exited' | 'error';

const MOCK_PROJECT = 'peri-studio';
const MOCK_CWD = '~/code/peri-studio';

const lifecycleMeta: Record<
  TerminalLifecycle,
  { statusLabel: string; tone: 'success' | 'neutral' | 'danger'; live: boolean }
> = {
  running: { statusLabel: 'Running', tone: 'success', live: true },
  exited: { statusLabel: 'Exited', tone: 'neutral', live: false },
  error: { statusLabel: 'Error', tone: 'danger', live: false },
};

/** Tier 4 · Terminal Dock：折叠仅隐藏 viewport，状态与路径放在紧凑 footer。 */
export function TerminalDockLayout() {
  const [expanded, setExpanded] = createSignal(true);
  const [lifecycle, setLifecycle] = createSignal<TerminalLifecycle>('running');

  const meta = () => lifecycleMeta[lifecycle()];

  return (
    <div class="flex flex-col">
      {/* 演示上下文：说明 project 绑定策略（非生产壳层） */}
      <p class="mb-3 text-12 text-content-muted">
        Mock workspace. Terminals stay bound to{' '}
        <span class="font-medium text-content-secondary">{MOCK_PROJECT}</span> even when the active project changes.
      </p>

      <div
        class="overflow-hidden rounded-lg border border-border-subtle bg-surface-muted"
        role="presentation"
      >
        <div class="flex h-40 items-center justify-center border-b border-border-subtle bg-surface-canvas px-4 text-center text-12 text-content-faint">
          Main panel · active project may differ from the terminal&apos;s bound project
        </div>

        <section
          aria-label="Terminal dock"
          class="border-t border-terminal-dock-border bg-terminal-dock-surface"
        >
          <header class="flex h-32 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-border-subtle px-2">
            <IconButton
              label={expanded() ? 'Collapse terminal viewport' : 'Expand terminal viewport'}
              size="sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded() ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </IconButton>

            <Terminal size={14} class="shrink-0 text-content-muted" aria-hidden="true" />

            <span class="truncate text-12 font-medium text-content-primary">zsh</span>
          </header>

          <Show when={expanded()}>
            <div
              class="h-(--terminal-viewport-height) overflow-auto bg-terminal-viewport-bg px-3 py-2 font-mono text-12 leading-relaxed"
              role="log"
              aria-live="off"
            >
              <Show
                when={lifecycle() === 'running'}
                fallback={
                  <Show
                    when={lifecycle() === 'exited'}
                    fallback={
                      <div class="space-y-2">
                        <p class="text-terminal-viewport-fg">
                          <span class="text-terminal-viewport-muted">$</span> bun run typecheck
                        </p>
                        <InlineNotice tone="danger" class="max-w-lg border-danger-border bg-danger-soft text-content-primary">
                          PTY attach failed: instance unreachable (presentation mock).
                        </InlineNotice>
                        <p class="text-terminal-viewport-muted">Process did not start. Retry from the agent or open a new terminal.</p>
                      </div>
                    }
                  >
                    <p class="text-terminal-viewport-muted">
                      <span class="text-terminal-viewport-fg">minho@studio</span>
                      <span class="text-terminal-viewport-muted">:</span>
                      <span class="text-terminal-viewport-accent">{MOCK_CWD}</span>
                      <span class="text-terminal-viewport-muted"> $ exit</span>
                    </p>
                    <p class="mt-2 text-terminal-viewport-muted">Session ended · PTY remains listed while collapsed.</p>
                  </Show>
                }
              >
                <p class="text-terminal-viewport-muted">
                  <span class="text-terminal-viewport-fg">minho@studio</span>
                  <span>:</span>
                  <span class="text-terminal-viewport-accent">{MOCK_CWD}</span>
                  <span> $</span>
                  <span class="text-terminal-viewport-fg"> bun run typecheck</span>
                </p>
                <p class="mt-1 text-terminal-viewport-fg">$ tsc -p ui-sandbox</p>
                <p class="text-terminal-viewport-muted">Done in 1.2s</p>
                <p class="mt-2 text-terminal-viewport-muted">
                  <span class="text-terminal-viewport-fg">minho@studio</span>
                  <span>:</span>
                  <span class="text-terminal-viewport-accent">{MOCK_CWD}</span>
                  <span> $</span>
                  <span class="inline-block w-2 animate-pulse bg-terminal-viewport-fg" aria-hidden="true" />
                </p>
              </Show>
            </div>
          </Show>

          <footer class="flex h-32 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap border-t border-border-subtle px-2 text-11 text-content-muted">
            <Status tone={meta().tone} label={meta().statusLabel} live={meta().live} class="shrink-0" />
            <span
              class="inline-flex min-w-0 items-center gap-1 overflow-hidden"
              title="Terminal is fixed to the project where it was created"
            >
              <FolderRoot size={12} class="shrink-0" aria-hidden="true" />
              <span class="truncate">Bound to {MOCK_PROJECT}</span>
            </span>
            <span class="min-w-0 truncate font-mono" title={MOCK_CWD}>{MOCK_CWD}</span>
          </footer>
        </section>
      </div>

      {/* 演示控件：切换生命周期展示，非 Dock 生产 UI */}
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="text-11 text-content-faint">Presentation:</span>
        {(['running', 'exited', 'error'] as const).map((state) => (
          <Button
            size="sm"
            variant={lifecycle() === state ? 'primary' : 'default'}
            onClick={() => setLifecycle(state)}
          >
            {state === 'running' ? 'Running' : state === 'exited' ? 'Exited' : 'Error'}
          </Button>
        ))}
      </div>
    </div>
  );
}
