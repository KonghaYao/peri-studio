import { ArrowLeftRight, Box, Briefcase, ChevronDown, ChevronRight, CircleDot, Sparkles } from 'lucide-solid';
import { For, Show, createSignal, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import {
  formatMonitorObservationDuration,
  formatMonitorObservationTokens,
} from './format';
import {
  monitorObservationChildConnectorClass,
  monitorObservationChildWrapClass,
  monitorObservationChildrenClass,
  monitorObservationChevronClass,
  monitorObservationChipChainClass,
  monitorObservationChipClass,
  monitorObservationChipGenerationClass,
  monitorObservationChipGenericClass,
  monitorObservationChipScoreClass,
  monitorObservationChipSpanClass,
  monitorObservationDurationClass,
  monitorObservationNameClass,
  monitorObservationRowClass,
  monitorObservationRowInteractiveClass,
  monitorObservationRowRootClass,
  monitorObservationTokensClass,
  monitorObservationTreeClass,
  monitorTraceErrorClass,
} from './monitor-panel-layout';
import type { MonitorObservationView } from './types';

export type MonitorObservationTreeProps = {
  observations: MonitorObservationView[];
  depth?: number;
  class?: string;
  onSelect?: (observation: MonitorObservationView) => void;
};

type ObservationVisualKind = 'span' | 'chain' | 'generation' | 'score' | 'generic';

function observationVisualKind(observation: MonitorObservationView): ObservationVisualKind {
  const kind = observation.kind.trim().toUpperCase();
  if (kind === 'GENERATION') return 'generation';
  if (kind === 'SCORE') return 'score';
  if (kind === 'SPAN' && /(?:^|[-_])(chain|stage)(?:[-_]|$)/i.test(observation.name)) return 'chain';
  if (kind === 'SPAN') return 'span';
  return 'generic';
}

function observationChipClass(kind: ObservationVisualKind): string {
  switch (kind) {
    case 'span':
      return monitorObservationChipSpanClass;
    case 'chain':
      return monitorObservationChipChainClass;
    case 'generation':
      return monitorObservationChipGenerationClass;
    case 'score':
      return monitorObservationChipScoreClass;
    default:
      return monitorObservationChipGenericClass;
  }
}

function ObservationKindIcon(props: { kind: ObservationVisualKind }): JSX.Element {
  const iconProps = { size: 14, strokeWidth: 1.7, 'aria-hidden': true as const };
  switch (props.kind) {
    case 'span':
      return <Briefcase {...iconProps} />;
    case 'chain':
      return <ArrowLeftRight {...iconProps} />;
    case 'generation':
      return <Sparkles {...iconProps} />;
    case 'score':
      return <CircleDot {...iconProps} />;
    default:
      return <Box {...iconProps} />;
  }
}

const MonitorObservationNode: Component<{
  observation: MonitorObservationView;
  depth: number;
  collapsed: () => Set<string>;
  onToggle: (id: string) => void;
  onSelect?: (observation: MonitorObservationView) => void;
}> = (props) => {
  const visualKind = () => observationVisualKind(props.observation);
  const children = () => props.observation.children ?? [];
  const hasChildren = () => children().length > 0;
  const expanded = () => !props.collapsed().has(props.observation.id);
  const duration = () => formatMonitorObservationDuration(props.observation.latencyMs);
  const tokens = () => formatMonitorObservationTokens(props.observation);

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren() ? expanded() : undefined}
    >
      <div
        data-testid={`monitor-observation-${props.observation.id}`}
        class={cn(
          monitorObservationRowClass,
          props.depth === 0 && monitorObservationRowRootClass,
          props.onSelect && monitorObservationRowInteractiveClass,
        )}
        role={props.onSelect ? 'button' : undefined}
        tabIndex={props.onSelect ? 0 : undefined}
        onClick={() => props.onSelect?.(props.observation)}
        onKeyDown={(event) => {
          if (!props.onSelect) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            props.onSelect?.(props.observation);
          }
        }}
      >
        <div class={cn(monitorObservationChipClass, observationChipClass(visualKind()))}>
          <ObservationKindIcon kind={visualKind()} />
        </div>
        <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-8 gap-y-2">
          <span class={monitorObservationNameClass}>{props.observation.name}</span>
          <Show when={duration()}>
            {(value) => <span class={monitorObservationDurationClass}>{value()}</span>}
          </Show>
          <Show when={tokens()}>
            {(value) => <span class={monitorObservationTokensClass}>{value()}</span>}
          </Show>
          <Show when={props.observation.level === 'ERROR'}>
            <span class={monitorTraceErrorClass}>Error</span>
          </Show>
        </div>
        <Show when={hasChildren()}>
          <IconButton
            size="compact"
            variant="ghost"
            class={cn(monitorObservationChevronClass, expanded() && 'opacity-100')}
            label={expanded() ? `Collapse ${props.observation.name}` : `Expand ${props.observation.name}`}
            showTooltip={false}
            aria-expanded={expanded()}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggle(props.observation.id);
            }}
          >
            <Show when={expanded()} fallback={<ChevronRight size={14} strokeWidth={1.7} aria-hidden="true" />}>
              <ChevronDown size={14} strokeWidth={1.7} aria-hidden="true" />
            </Show>
          </IconButton>
        </Show>
      </div>
      <Show when={hasChildren() && expanded()}>
        <div class={monitorObservationChildrenClass} role="group">
          <For each={children()}>
            {(child) => (
              <div class={monitorObservationChildWrapClass}>
                <div class={monitorObservationChildConnectorClass} aria-hidden="true" />
                <div class="min-w-0 flex-1">
                  <MonitorObservationNode
                    observation={child}
                    depth={props.depth + 1}
                    collapsed={props.collapsed}
                    onToggle={props.onToggle}
                    onSelect={props.onSelect}
                  />
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

/** T3 · Langfuse observation 树（只读，无 prompt IO）。 */
export const MonitorObservationTree: Component<MonitorObservationTreeProps> = (props) => {
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set());

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div
      class={cn(monitorObservationTreeClass, props.class)}
      data-testid="monitor-observation-tree"
      role="tree"
      aria-label="Trace observations"
    >
      <Show
        when={props.observations.length > 0}
        fallback={<div class="px-12 py-16 text-center text-11 text-content-muted">No observations for this trace.</div>}
      >
        <For each={props.observations}>
          {(observation) => (
            <MonitorObservationNode
              observation={observation}
              depth={props.depth ?? 0}
              collapsed={collapsed}
              onToggle={toggle}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </Show>
    </div>
  );
};
