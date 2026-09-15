import { AppWindow, Check, CircleX, Loader2 } from 'lucide-solid';
import { Show, splitProps, type Component } from 'solid-js';
import { Button } from '../Button';
import { cn } from '../../lib/cn';

export type McpAppHistoricalStatus = 'done' | 'running' | 'failed';

export type McpAppHistoricalCardProps = {
  title: string;
  subtitle?: string;
  message: string;
  status?: McpAppHistoricalStatus;
  variant?: 'default' | 'activity';
  class?: string;
  reopenLabel?: string;
  reopenDisabled?: boolean;
  reopenPending?: boolean;
  onReopen?: () => void;
};

/** 无 live HTML 时的 MCP App 占位卡：不展开工具参数/结果。 */
export const McpAppHistoricalCard: Component<McpAppHistoricalCardProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'title',
    'subtitle',
    'message',
    'status',
    'variant',
    'class',
    'reopenLabel',
    'reopenDisabled',
    'reopenPending',
    'onReopen',
  ]);
  const status = () => local.status ?? 'done';
  const activity = () => local.variant === 'activity';
  const showReopen = () => Boolean(local.onReopen && local.reopenLabel);

  return (
    <div
      {...rest}
      class={cn(
        'ui-mcp-app-historical w-full max-w-(--tool-activity-max)',
        activity() && 'tool-activity-row--activity',
        local.class,
      )}
      data-testid="mcp-app-historical-card"
    >
      <div
        class={cn(
          'ui-mcp-app-historical-shell overflow-hidden rounded-9 border border-divider bg-surface',
          activity() && 'rounded-6',
        )}
      >
        <div
          class={cn(
            'flex min-h-88 items-start gap-9 px-10 py-10',
            activity() && 'min-h-0 py-8',
          )}
        >
          <span
            class={cn(
              'grid size-22 shrink-0 place-items-center rounded-6 text-content-muted',
              status() === 'done' && 'text-success-solid',
              status() === 'failed' && 'text-danger-solid',
            )}
            role="img"
            aria-label={status() === 'running' ? 'Running' : status() === 'failed' ? 'Failed' : 'Done'}
          >
            <Show when={status() === 'running'} fallback={
              <Show when={status() === 'failed'} fallback={<Check size={14} strokeWidth={2.4} />}>
                <CircleX size={14} strokeWidth={2} />
              </Show>
            }>
              <Loader2 size={14} strokeWidth={2} class="animate-spin" />
            </Show>
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-4">
            <div class="flex min-w-0 items-center gap-8">
              <AppWindow size={14} strokeWidth={1.8} class="shrink-0 text-content-muted" aria-hidden="true" />
              <span class="min-w-0 truncate text-12 font-650 text-content-primary">{local.title}</span>
            </div>
            <Show when={local.subtitle}>
              {(subtitle) => <span class="truncate text-11 text-content-muted">{subtitle()}</span>}
            </Show>
            <p class="m-0 text-11 leading-normal text-content-secondary">{local.message}</p>
            <Show when={showReopen()}>
              <Button
                type="button"
                variant="default"
                size="sm"
                class="self-start"
                disabled={local.reopenDisabled || local.reopenPending}
                busy={local.reopenPending}
                onClick={() => local.onReopen?.()}
                data-testid="mcp-app-reopen-button"
              >
                {local.reopenLabel}
              </Button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};
