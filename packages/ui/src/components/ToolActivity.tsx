import {
  Ban,
  Check,
  ChevronRight,
  Circle,
  CircleX,
  Clock3,
  Loader2,
  ShieldQuestion,
  Wrench,
  type LucideIcon,
} from 'lucide-solid';
import {
  createMemo,
  createSignal,
  For,
  Show,
  splitProps,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../lib/cn';
import { CopyButton } from './CopyButton';
import { IconButton } from './Button';
import { Shimmer } from './Shimmer';

export type ToolCallStatus = 'queued' | 'running' | 'done' | 'failed' | 'approval' | 'neutral';

const STATUS: Record<Exclude<ToolCallStatus, 'neutral'>, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  approval: 'Approval',
};

export type ToolActivityFilePreview = {
  prefix: string;
  pathLabel: string;
  path: string;
  onOpen?: (event: MouseEvent) => void;
};

export type ToolActivityEvidence =
  | { kind: 'value'; label: string; value: string; tone?: 'error' }
  | { kind: 'omitted'; label: string; sizeLabel?: string | null; noun: string }
  | { kind: 'message'; text: string; italic?: boolean };

function ToolStatusIcon(props: { status: ToolCallStatus; label: string }) {
  return (
    <span
      class={cn(
        'tool-call-row-status grid size-22 shrink-0 place-items-center rounded-6 text-content-muted',
        props.status === 'done' && 'text-success-solid',
        props.status === 'failed' && 'text-danger-solid',
        props.status === 'approval' && 'text-accent-solid',
        props.status === 'neutral' && 'text-content-faint',
      )}
      data-tool-status={props.status}
      role="img"
      aria-label={props.label}
      title={props.label}
    >
      <Show when={props.status === 'done'}><Check size={14} strokeWidth={2.4} /></Show>
      <Show when={props.status === 'failed'}><CircleX size={14} strokeWidth={2} /></Show>
      <Show when={props.status === 'approval'}><ShieldQuestion size={14} strokeWidth={1.9} /></Show>
      <Show when={props.status === 'running'}><Loader2 size={14} strokeWidth={2} class="animate-spin" /></Show>
      <Show when={props.status === 'queued'}><Clock3 size={14} strokeWidth={1.9} /></Show>
      <Show when={props.status === 'neutral'}>
        <Show when={props.label === 'Cancelled'} fallback={<Circle size={11} strokeWidth={2} />}>
          <Ban size={14} strokeWidth={1.9} />
        </Show>
      </Show>
    </span>
  );
}

function EvidenceBlock(props: { label: string; value: string; tone?: 'error' }) {
  return (
    <div class="min-w-0 rounded-md bg-surface-sunken px-10 py-8">
      <div class="mb-4 flex items-center gap-8">
        <span class="text-10 font-medium text-content-muted">{props.label}</span>
        <span class="flex-1" />
        <CopyButton text={props.value} label={`Copy ${props.label}`} size="compact" />
      </div>
      <pre
        class={cn(
          'm-0 max-h-180 overflow-auto font-mono text-11 leading-relaxed whitespace-pre-wrap',
          props.tone === 'error' ? 'text-danger-solid' : 'text-content-primary',
        )}
      >
        <code>{props.value}</code>
      </pre>
    </div>
  );
}

function OmittedEvidence(props: { label: string; sizeLabel?: string | null; noun: string }) {
  return (
    <aside class="flex flex-col gap-4 rounded-md border border-warning-border bg-surface-overlay px-10 py-8 text-11 leading-normal text-content-secondary" role="note">
      <strong class="text-11 text-warning-solid">{props.label}</strong>
      <span>
        Hub observed {props.noun}
        {props.sizeLabel ? ` of about ${props.sizeLabel}` : ''} that exceeds the page projection limit. The content was not written to this session view.
      </span>
    </aside>
  );
}

type ToolActivityRowProps = {
  icon?: LucideIcon;
  toolKind?: string;
  title: string;
  subtitle?: string;
  errorDetail?: string;
  status: ToolCallStatus;
  statusLabel?: string;
  duration?: string;
  variant?: 'default' | 'activity';
  toolCallId?: string;
  filePreview?: ToolActivityFilePreview;
  evidence?: ToolActivityEvidence[];
  /** @deprecated 使用 evidence；catalog demo 兼容。 */
  input?: string;
  /** @deprecated 使用 evidence；catalog demo 兼容。 */
  output?: string;
  /** @deprecated 使用 evidence；catalog demo 兼容。 */
  error?: string;
  evidenceLoaded?: boolean;
  onOpenEvidence?: () => void;
  class?: string;
};

/** Fenix 风格工具活动行：icon + 摘要 + 状态；可展开 input/output 证据。 */
export const ToolActivityRow: Component<ToolActivityRowProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  let evidenceBody: HTMLDivElement | undefined;
  const statusLabel = createMemo(() => {
    if (props.statusLabel) return props.statusLabel;
    if (props.status === 'neutral') return 'Unknown status';
    return STATUS[props.status];
  });
  const evidence = createMemo(() => {
    if (props.evidence && props.evidence.length > 0) return props.evidence;
    const items: ToolActivityEvidence[] = [];
    if (props.input) items.push({ kind: 'value', label: 'Input', value: props.input });
    if (props.output) items.push({ kind: 'value', label: 'Output', value: props.output });
    if (props.error) items.push({ kind: 'value', label: 'Error', value: props.error, tone: 'error' });
    return items;
  });
  const hasEvidence = () => evidence().length > 0;
  const activity = () => props.variant === 'activity';
  const isRunning = () => props.status === 'running';
  const isError = () => props.status === 'failed';
  const isCanceled = () => props.status === 'neutral' && statusLabel() === 'Cancelled';
  const filePreview = () => props.filePreview;

  const toggle = () => {
    if (!hasEvidence()) return;
    if (!open()) {
      props.onOpenEvidence?.();
      setOpen(true);
      requestAnimationFrame(() => {
        evidenceBody?.scrollIntoView?.({ block: 'nearest' });
      });
      return;
    }
    setOpen(false);
  };

  const openPath = (event: MouseEvent) => {
    event.stopPropagation();
    props.filePreview?.onOpen?.(event);
  };

  const runningTitle = (className: string) => (
    <Shimmer as="span" duration={1.2} spread={2} class={className}>
      {props.title}
    </Shimmer>
  );

  const rowContent = (
    <>
      <div
        class={cn(
          'tool-call-row-compact min-h-(--pattern-row-height) rounded-6 p-2',
          isError() && 'is-error',
          isCanceled() && 'is-cancelled opacity-55',
          isRunning() && 'is-running bg-sidebar-selected hover:bg-sidebar-selected',
        )}
      >
        <div
          class="chat-tool-call-row grid w-full min-w-0 grid-cols-tool-row items-center gap-9 text-left text-inherit"
          data-testid="tool-activity-row-summary"
        >
          <span
            class={cn(
              'tool-call-row-icon relative z-1 grid size-22 shrink-0 place-items-center rounded-md text-content-muted',
              isRunning() ? 'bg-sidebar-selected' : 'bg-surface',
            )}
            data-tool-kind={props.toolKind}
            aria-hidden="true"
          >
            <Dynamic component={props.icon ?? Wrench} size={15} strokeWidth={1.8} />
          </span>

          <span
            class={cn(
              'tool-call-row-copy block min-w-0 overflow-hidden',
              filePreview() && 'is-file-preview',
            )}
          >
            <span class="tool-call-row-heading flex min-w-0 items-baseline gap-9 overflow-hidden">
              <Show
                when={filePreview()}
                fallback={(
                  <Show
                    when={isRunning()}
                    fallback={(
                      <span class="tool-call-row-title min-w-0 truncate text-12 font-normal text-content-muted" title={props.title}>
                        {props.title}
                      </span>
                    )}
                  >
                    {runningTitle('tool-call-row-title min-w-0 max-w-full truncate text-12 font-normal')}
                  </Show>
                )}
              >
                {(preview) => (
                  <span class="tool-call-row-title inline-flex min-w-0 items-baseline gap-5 overflow-hidden text-12 font-normal text-content-muted" title={preview().path}>
                    <span class="shrink-0">{preview().prefix}</span>
                    <button
                      type="button"
                      data-testid="tool-activity-file-link"
                      class="tool-call-row-file-link inline-block min-w-0 max-w-full truncate align-bottom text-link hover:underline hover:underline-offset-2"
                      onClick={openPath}
                    >
                      {preview().pathLabel}
                    </button>
                  </span>
                )}
              </Show>
              <Show when={props.subtitle}>
                <span class="tool-call-row-meta flex min-w-0 items-baseline gap-5 overflow-hidden text-11 font-normal text-content-faint">
                  <span class="truncate">{props.subtitle}</span>
                </span>
              </Show>
              <Show when={props.errorDetail}>
                <span class="tool-call-row-error min-w-0 truncate text-11 text-danger-solid" title={props.errorDetail}>
                  {props.errorDetail}
                </span>
              </Show>
            </span>
          </span>

          <span class="tool-call-row-end flex shrink-0 items-center justify-self-end gap-12">
            <Show when={props.duration}>
              <span class="tool-call-row-duration min-w-42 text-right text-10 text-content-muted tabular-nums">
                {props.duration}
              </span>
            </Show>
            <ToolStatusIcon status={props.status} label={statusLabel()} />
          </span>

          <Show when={hasEvidence()}>
            <IconButton
              size="compact"
              data-testid="tool-activity-row-expand"
              label={open() ? 'Collapse tool details' : 'Expand tool details'}
              class="chat-tool-call-row-expand size-22 border-0 bg-transparent text-content-faint hover:bg-interaction-hover"
              aria-expanded={open()}
              onClick={toggle}
            >
              <ChevronRight
                size={13}
                class={cn('transition-transform duration-(--duration-fast)', open() && 'rotate-90')}
              />
            </IconButton>
          </Show>

          <Show when={props.toolCallId}>
            <code class="sr-only">{props.toolCallId}</code>
          </Show>
        </div>
      </div>

      <Show when={open() && hasEvidence() && (props.evidenceLoaded ?? true)}>
        <div
          ref={evidenceBody}
          class={cn(
            'tool-activity-row__body flex flex-col gap-6 pb-8 pl-16 pr-10',
            activity() ? 'mt-0 border-t border-border-faint pt-8' : 'mt-4 pb-4 pr-8',
          )}
          data-testid="tool-activity-row-body"
        >
          <For each={evidence()}>{(item) => {
            if (item.kind === 'value') {
              return <EvidenceBlock label={item.label} value={item.value} tone={item.tone} />;
            }
            if (item.kind === 'omitted') {
              return <OmittedEvidence label={item.label} sizeLabel={item.sizeLabel} noun={item.noun} />;
            }
            return (
              <p class={cn('m-0 text-11 leading-normal text-content-secondary', item.italic && 'italic')}>
                {item.text}
              </p>
            );
          }}</For>
        </div>
      </Show>
    </>
  );

  return (
    <div
      data-slot="tool-activity-row"
      class={cn(
        'tool-activity-row min-w-0',
        activity() && 'tool-activity-row--activity',
        !activity() && 'overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay p-6',
        props.class,
      )}
      data-testid="tool-activity-row"
    >
      {rowContent}
    </div>
  );
};

type ToolActivityGroupProps = ComponentProps<'div'> & {
  variant?: 'default' | 'activity';
  showRail?: boolean;
};

/** 工具活动组：可选左侧轨道 + 多行活动。 */
export const ToolActivityGroup: Component<ToolActivityGroupProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'variant', 'showRail']);
  const activity = () => local.variant === 'activity';
  const showRail = () => local.showRail ?? !activity();

  return (
    <div
      data-slot="tool-activity-group"
      class={cn(
        'tool-activity-group',
        activity()
          ? 'tool-activity-group--activity tool-call-group-list grid w-full max-w-(--chat-tool-activity-max) min-w-0 gap-px'
          : 'flex max-w-(--chat-tool-activity-max) min-w-0 flex-col gap-8 rounded-lg border border-border-subtle bg-surface-overlay p-8',
        showRail() && 'relative isolate',
        local.class,
      )}
      data-testid="tool-activity-group"
      {...rest}
    >
      <Show when={showRail()}>
        <span
          class="absolute inset-y-0 left-(--chat-activity-rail-left) z-0 w-px bg-border-strong"
          aria-hidden="true"
        />
      </Show>
      {local.children}
    </div>
  );
};
