import { For, Show } from 'solid-js';
import type { AgentActivityInfo, AgentActivityKind, AgentActivityStatus } from '../lib/control-view';
import { messageTime } from '../lib/message-time.ts';
import { CollapsibleSection } from './shared/CollapsibleSection';

export interface AgentActivityRailProps {
  activities: AgentActivityInfo[];
}

const KIND_LABEL: Record<AgentActivityKind, string> = {
  subagent: 'Sub-agent',
  background_task: 'Background task',
  compact: 'Context compaction',
  context: 'Context',
  llm_retry: 'Model retry',
  workflow: 'Workflow',
  rewind: 'Session rewind',
  diagnostics: 'Diagnostics',
  turn: 'Turn processing',
  agent: 'Agent',
  system: 'System',
  oauth: 'Authorization',
};

const STATUS_LABEL: Record<AgentActivityStatus, string> = {
  running: 'Running', completed: 'Completed', failed: 'Failed', warning: 'Needs attention',
  suspended: 'Suspended', cancelled: 'Cancelled', info: 'Logged',
};

const METRIC_LABEL: Record<string, string> = {
  duration_ms: 'Duration', tool_count: 'Tools', step: 'Steps', file_count: 'Files',
  skill_count: 'Skills', token_before: 'Before compaction', token_after: 'After compaction',
  used_tokens: 'Context used', total_tokens: 'Context limit', attempt: 'Retry',
  max_attempts: 'Max retries', delay_ms: 'Wait', error_count: 'Errors',
  warning_count: 'Warnings', agent_count: 'Agent', tokens_in: 'Input', tokens_out: 'Output',
};

function formatMetric(key: string, value: number): string {
  if (key.endsWith('_ms')) return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} s` : `${value} ms`;
  if (key.includes('token')) return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
  return new Intl.NumberFormat('en-US').format(value);
}

function ActivityRow(props: { activity: AgentActivityInfo }) {
  const time = () => props.activity.updatedAt ? messageTime(props.activity.updatedAt) : null;
  const metrics = () => Object.entries(props.activity.metrics).filter(([key]) => METRIC_LABEL[key]).slice(0, 3);
  const markerTone = () => {
    switch (props.activity.status) {
      case 'running': return 'border-success bg-success';
      case 'failed': return 'border-danger bg-danger';
      case 'warning': case 'suspended': return 'border-warning bg-warning';
      default: return 'border-text-faint bg-surface';
    }
  };
  return <li class={`agent-activity__item agent-activity__item--${props.activity.status} relative grid grid-cols-activity gap-9 items-start min-h-42 px-3 py-7 after:absolute after:bottom-0 after:left-19 after:right-0 after:h-1 after:bg-divider last:after:hidden max-narrow:grid-cols-[10px_minmax(0,1fr)]`}>
    <span class={`agent-activity__marker size-7 mt-5 border rounded-full ${markerTone()}`} aria-hidden="true" />
    <div class="agent-activity__copy min-w-0">
      <div class="flex min-w-0 gap-7 items-baseline"><strong class="overflow-hidden text-11p5 font-semibold text-ellipsis whitespace-nowrap">{props.activity.label || KIND_LABEL[props.activity.kind]}</strong><span class="flex-none text-text-muted text-10">{STATUS_LABEL[props.activity.status]}</span></div>
      <Show when={metrics().length > 0}><dl class="flex flex-wrap gap-x-10 gap-y-3 mt-3 max-narrow:hidden"><For each={metrics()}>{([key, value]) => <div class="flex gap-4"><dt class="m-0 text-text-muted text-10">{METRIC_LABEL[key]}</dt><dd class="m-0 text-text-secondary tabular-nums text-10">{formatMetric(key, value)}</dd></div>}</For></dl></Show>
    </div>
    <Show when={time()}>{(value) => <time class="mt-2 text-text-muted text-10 whitespace-nowrap max-narrow:col-start-2" dateTime={props.activity.updatedAt ?? undefined} title={value().exact}>{value().label}</time>}</Show>
  </li>;
}

/** A quiet read-only projection of negotiated Peri-exclusive capabilities. */
export function AgentActivityRail(props: AgentActivityRailProps) {
  const latestFirst = () => [...props.activities].reverse();
  const attentionActivities = () => latestFirst().filter((activity) => ['running', 'failed', 'warning', 'suspended'].includes(activity.status));
  const latest = () => attentionActivities()[0];
  const pulseTone = (status: AgentActivityStatus) => {
    if (status === 'running') return 'bg-success shadow-success-ring';
    if (status === 'warning' || status === 'suspended') return 'bg-warning';
    if (status === 'failed') return 'bg-danger';
    return 'bg-text-muted';
  };
  return <Show when={latest()}>{(current) =>
    <CollapsibleSection
      detailsClass="agent-activity group w-(--container-activity) flex-none mx-auto mt-8 border border-border-subtle rounded-12 bg-activity-bg text-text-primary max-narrow:w-[calc(100%-20px)] max-narrow:mt-6"
      summaryClass="flex min-h-36 items-center gap-8 px-11 py-4 cursor-pointer list-none focus-visible:rounded-13 focus-visible:outline-offset-neg-2"
      label="Peri activity"
      mark={<span class={`agent-activity__pulse agent-activity__pulse--${current().status} size-8 flex-none rounded-full ${pulseTone(current().status)}`} aria-hidden="true" />}
      copy={<span class="agent-activity__summary-copy flex min-w-0 flex-1 items-baseline gap-8">
        <strong class="overflow-hidden text-text-primary text-11 font-650 text-ellipsis whitespace-nowrap">{current().label || KIND_LABEL[current().kind]}</strong>
        <span class="sr-only">{STATUS_LABEL[current().status]}</span>
      </span>}
      meta={<Show when={attentionActivities().length > 1}><span class="agent-activity__count grid min-w-19 h-19 place-items-center rounded-full bg-surface-muted text-text-muted text-10 tabular-nums">{attentionActivities().length}</span></Show>}
      chevronClass="agent-activity__chevron text-text-muted text-18 transition-transform duration-140 group-open:rotate-90"
    >
      <div class="agent-activity__body max-h-240 overflow-auto border-t border-divider pt-9 pr-11 pb-11 pl-11 max-narrow:max-h-210">
        <ol class="flex flex-col m-0 p-0 list-none"><For each={latestFirst()}>{(activity) => <ActivityRow activity={activity} />}</For></ol>
      </div>
    </CollapsibleSection>
  }</Show>;
}
