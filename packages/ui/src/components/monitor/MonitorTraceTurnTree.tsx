import { ChevronRight, Filter, ListTree } from 'lucide-solid';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
  type Component,
} from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import {
  buildTraceTurnSections,
  buildTraceTurnTree,
  collectTraceTurnTreeNodeIds,
  defaultIsNoiseObservation,
  type BuildTraceTurnTreeOptions,
  type MonitorTraceObservationFlat,
  type MonitorTraceTurnInput,
  type MonitorTraceTurnTreeNode,
} from './build-trace-turn-tree';
import { formatMonitorLatency } from './format';
import {
  MonitorObservationLevelBadge,
  MonitorObservationTypeIcon,
} from './MonitorObservationBadge';
import {
  monitorObservationTreeClass,
  monitorTraceTurnTreeClass,
  monitorTraceTurnTreeDepthClass,
  monitorTraceTurnTreeRowClass,
  monitorTraceTurnTreeRowInteractiveClass,
  monitorTraceTurnTreeRowSelectedClass,
} from './monitor-panel-layout';
import {
  formatMonitorTraceClockTime,
  formatMonitorTraceCompactTokens,
  formatMonitorTraceDuration,
  monitorTraceToolOutputTokens,
} from './trace-turn-tree-format';

export type MonitorTraceTurnTreeProps = {
  observations?: MonitorTraceObservationFlat[];
  turns?: MonitorTraceTurnInput[];
  nodes?: MonitorTraceTurnTreeNode[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  omitNoise?: boolean;
  onOmitNoiseChange?: (value: boolean) => void;
  isNoise?: (observation: MonitorTraceObservationFlat) => boolean;
  showOmitNoiseToggle?: boolean;
  traceRoot?: { name: string; latencyMs?: number };
  selectedTraceRoot?: boolean;
  onTraceRootSelect?: () => void;
  enableKeyboardNav?: boolean;
  class?: string;
  'data-testid'?: string;
};

type TreeSection = {
  key: string;
  label?: string;
  nodes: MonitorTraceTurnTreeNode[];
};

function buildOptions(props: Pick<MonitorTraceTurnTreeProps, 'omitNoise' | 'isNoise'>): BuildTraceTurnTreeOptions {
  return {
    omitNoise: props.omitNoise ?? true,
    isNoise: props.isNoise ?? defaultIsNoiseObservation,
  };
}

function resolveSections(props: MonitorTraceTurnTreeProps): TreeSection[] {
  if (props.nodes) return [{ key: 'nodes', nodes: props.nodes }];
  if (props.turns?.length) {
    return buildTraceTurnSections(props.turns, buildOptions(props)).map((section) => ({
      key: section.turn.id,
      label: section.turn.label,
      nodes: section.nodes,
    }));
  }
  return [{
    key: 'trace',
    nodes: buildTraceTurnTree(props.observations ?? [], buildOptions(props)),
  }];
}

const MonitorTraceTurnOmitNoiseToggle: Component<{
  omitNoise: boolean;
  onChange: (value: boolean) => void;
}> = (props) => (
  <IconButton
    size="compact"
    variant="ghost"
    class={cn(
      'h-28 w-28 border-0',
      props.omitNoise && 'bg-surface-sunken text-content-primary',
    )}
    label={props.omitNoise ? 'Hide noise nodes (stage-*)' : 'Show all nodes'}
    showTooltip={false}
    aria-pressed={props.omitNoise}
    onClick={() => props.onChange(!props.omitNoise)}
  >
    <Filter size={14} strokeWidth={1.7} aria-hidden="true" />
  </IconButton>
);

const MonitorTraceTurnTreeNodeRow: Component<{
  node: MonitorTraceTurnTreeNode;
  depth: number;
  expanded: () => Set<string>;
  onToggle: (id: string) => void;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}> = (props) => {
  const observation = () => props.node.observation;
  const hasChildren = () => props.node.children.length > 0;
  const isExpanded = () => !props.expanded().has(observation().id);
  const isSelected = () => props.selectedId === observation().id;
  const interactive = () => Boolean(props.onSelect);
  const outputTokens = () => monitorTraceToolOutputTokens(observation());
  const durationLabel = () => {
    if (observation().type.toUpperCase() === 'EVENT') {
      return formatMonitorTraceClockTime(observation().startTime);
    }
    return formatMonitorTraceDuration(observation().startTime, observation().endTime);
  };

  return (
    <div>
      <div
        data-testid={`monitor-trace-turn-node-${observation().id}`}
        role={interactive() ? 'button' : undefined}
        tabIndex={interactive() ? 0 : undefined}
        class={cn(
          monitorTraceTurnTreeRowClass,
          monitorTraceTurnTreeDepthClass(props.depth),
          interactive() && monitorTraceTurnTreeRowInteractiveClass,
          isSelected() && monitorTraceTurnTreeRowSelectedClass,
        )}
        onClick={() => props.onSelect?.(observation().id)}
        onKeyDown={(event) => {
          if (!props.onSelect) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            props.onSelect(observation().id);
          }
        }}
      >
        <Show
          when={hasChildren()}
          fallback={<span class="w-18 shrink-0" aria-hidden="true" />}
        >
          <button
            type="button"
            class="flex h-18 w-18 shrink-0 items-center justify-center rounded-4 hover:bg-interaction-hover"
            aria-label={isExpanded() ? 'Collapse' : 'Expand'}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggle(observation().id);
            }}
          >
            <ChevronRight
              size={14}
              strokeWidth={1.7}
              class={cn('transition-transform', isExpanded() && 'rotate-90')}
              aria-hidden="true"
            />
          </button>
        </Show>
        <MonitorObservationTypeIcon type={observation().type} />
        <span class="min-w-0 flex-1 truncate font-500 text-content-primary">
          {observation().name ?? <span class="text-content-muted">(unnamed)</span>}
        </span>
        <Show when={observation().level && observation().level !== 'DEFAULT'}>
          <MonitorObservationLevelBadge level={observation().level} />
        </Show>
        <span class="ml-auto flex shrink-0 items-center gap-8 pl-8 font-mono text-10 text-content-muted">
          <Show when={outputTokens() != null}>
            <span class="text-content-muted" title="Estimated output tokens">
              ~{formatMonitorTraceCompactTokens(outputTokens())} tokens
            </span>
          </Show>
          <span>{durationLabel()}</span>
        </span>
      </div>
      <Show when={hasChildren() && isExpanded()}>
        <For each={props.node.children}>
          {(child) => (
            <MonitorTraceTurnTreeNodeRow
              node={child}
              depth={props.depth + 1}
              expanded={props.expanded}
              onToggle={props.onToggle}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </Show>
    </div>
  );
};

/** T3 · Langfuse trace 全量 observation 树（自 peri-fuse `observation-tree`）。 */
export const MonitorTraceTurnTree: Component<MonitorTraceTurnTreeProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'observations',
    'turns',
    'nodes',
    'selectedId',
    'onSelect',
    'omitNoise',
    'onOmitNoiseChange',
    'isNoise',
    'showOmitNoiseToggle',
    'traceRoot',
    'selectedTraceRoot',
    'onTraceRootSelect',
    'enableKeyboardNav',
    'class',
  ]);

  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());
  const sections = createMemo(() => resolveSections(local));
  const allNodes = createMemo(() => sections().flatMap((section) => section.nodes));

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandedSet = createMemo(() => {
    const collapsedIds = collapsed();
    const expandedIds = new Set<string>();
    const walk = (list: MonitorTraceTurnTreeNode[]) => {
      for (const item of list) {
        expandedIds.add(item.observation.id);
        if (item.children.length > 0 && !collapsedIds.has(item.observation.id)) {
          walk(item.children);
        }
      }
    };
    walk(allNodes());
    return expandedIds;
  });

  createEffect(() => {
    if (!local.enableKeyboardNav || !local.onSelect) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable)
      ) return;
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

      const ids = collectTraceTurnTreeNodeIds(allNodes(), expandedSet());
      if (local.traceRoot) ids.unshift('__trace_root__');
      if (ids.length === 0) return;

      const currentId = local.selectedTraceRoot ? '__trace_root__' : local.selectedId;
      const index = currentId ? ids.indexOf(currentId) : -1;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = index < 0
        ? (event.key === 'ArrowDown' ? 0 : ids.length - 1)
        : (index + delta + ids.length) % ids.length;
      event.preventDefault();
      const nextId = ids[nextIndex];
      if (nextId === '__trace_root__') local.onTraceRootSelect?.();
      else local.onSelect?.(nextId);
    };
    window.addEventListener('keydown', handler);
    onCleanup(() => window.removeEventListener('keydown', handler));
  });

  const hasContent = () => allNodes().length > 0 || Boolean(local.traceRoot);

  return (
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'monitor-trace-turn-tree'}
      class={cn(monitorTraceTurnTreeClass, local.class)}
    >
      <Show when={local.showOmitNoiseToggle && local.onOmitNoiseChange}>
        <div class="flex shrink-0 items-center justify-end border-b border-border-subtle px-4 py-4">
          <MonitorTraceTurnOmitNoiseToggle
            omitNoise={local.omitNoise ?? true}
            onChange={(value) => local.onOmitNoiseChange?.(value)}
          />
        </div>
      </Show>

      <div
        class={cn(monitorObservationTreeClass, 'min-h-0 flex-1')}
        role="tree"
        aria-label="Trace observation tree"
      >
        <Show
          when={hasContent()}
          fallback={(
            <div class="px-4 py-4 text-center text-11 text-content-muted">
              No observations in this trace.
            </div>
          )}
        >
          <Show when={local.traceRoot}>
            {(root) => (
              <div
                data-testid="monitor-trace-turn-tree-root"
                role="button"
                tabIndex={0}
                class={cn(
                  monitorTraceTurnTreeRowClass,
                  monitorTraceTurnTreeDepthClass(0),
                  monitorTraceTurnTreeRowInteractiveClass,
                  local.selectedTraceRoot && monitorTraceTurnTreeRowSelectedClass,
                )}
                onClick={() => local.onTraceRootSelect?.()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    local.onTraceRootSelect?.();
                  }
                }}
              >
                <span class="w-18 shrink-0" aria-hidden="true" />
                <ListTree size={14} strokeWidth={1.7} class="shrink-0 text-content-secondary" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate font-500 text-content-primary">{root().name}</span>
                <Show when={root().latencyMs !== undefined}>
                  <span class="ml-auto font-mono text-10 text-content-muted">
                    {formatMonitorLatency(root().latencyMs)}
                  </span>
                </Show>
              </div>
            )}
          </Show>

          <For each={sections()}>
            {(section) => (
              <div class="flex flex-col">
                <Show when={section.label}>
                  <div class="px-4 py-4 text-10 font-600 uppercase tracking-wide text-content-muted">
                    {section.label}
                  </div>
                </Show>
                <For each={section.nodes}>
                  {(node) => (
                    <MonitorTraceTurnTreeNodeRow
                      node={node}
                      depth={local.traceRoot ? 1 : 0}
                      expanded={() => collapsed()}
                      onToggle={toggle}
                      selectedId={local.selectedId}
                      onSelect={local.onSelect}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};
