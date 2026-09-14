import { createSignal, For, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { formatMonitorLatency } from './format';
import {
  MonitorObservationLevelBadge,
  MonitorObservationTypeIcon,
} from './MonitorObservationBadge';
import {
  MONITOR_TIMELINE_BAR_COLORS,
  MONITOR_TIMELINE_BAR_FALLBACK,
  MONITOR_TIMELINE_BLOCK_HEIGHT,
  MONITOR_TIMELINE_GROUP_GAP,
  MONITOR_TIMELINE_LABEL_WIDTH,
  MONITOR_TIMELINE_LANE_HEIGHT,
  MONITOR_TIMELINE_TICK_TARGET_PX,
  MONITOR_TIMELINE_TRACE_COLORS,
  formatMonitorTimelineTickLabel,
  monitorTimelineNiceTickStep,
  type MonitorTimelineBandSegment,
  type MonitorTimelineDurationOpacity,
  type MonitorTimelineTypeLaneGroup,
} from './monitor-timeline-layout';

export type MonitorTimelineRulerProps = {
  totalMs: number;
  pxPerMs: number;
  width: number;
  class?: string;
};

/** T3 · 时间轴刻度尺。 */
export const MonitorTimelineRuler: Component<MonitorTimelineRulerProps> = (props) => {
  const totalMs = () => props.totalMs;
  const pxPerMs = () => props.pxPerMs;
  const width = () => props.width;

  const stepMs = () => {
    if (pxPerMs() <= 0) return 0;
    return monitorTimelineNiceTickStep(MONITOR_TIMELINE_TICK_TARGET_PX / pxPerMs());
  };

  const ticks = () => {
    const step = stepMs();
    if (step <= 0) return [];
    const values: number[] = [];
    for (let time = 0; time <= totalMs(); time += step) values.push(time);
    return values;
  };

  const labelEvery = () => {
    const stepPx = stepMs() * pxPerMs();
    return Math.max(1, Math.ceil(55 / stepPx));
  };

  return (
    <div
      class={cn('relative h-24 shrink-0 select-none border-b border-border-subtle', props.class)}
      style={{ width: `${width()}px` }}
    >
      <Show when={pxPerMs() > 0} fallback={<div class="h-24" />}>
        <div
          class="absolute inset-y-0 border-r border-border-subtle"
          style={{ width: `${MONITOR_TIMELINE_LABEL_WIDTH}px` }}
        />
        <For each={ticks()}>
          {(time, index) => (
            <div
              class={cn(
                'absolute bottom-0 border-l',
                index() % 5 === 0 ? 'h-10 border-border-strong' : 'h-6 border-border-faint',
              )}
              style={{ left: `${MONITOR_TIMELINE_LABEL_WIDTH + time * pxPerMs()}px` }}
            >
              <Show when={index() % labelEvery() === 0}>
                <span class="absolute left-6 top-0 whitespace-nowrap font-mono text-10 text-content-muted">
                  {formatMonitorTimelineTickLabel(time, stepMs())}
                </span>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
};

type HoverState = {
  segment: MonitorTimelineBandSegment;
  leftPx: number;
  topPx: number;
};

type TimelineBlockProps = {
  segment: MonitorTimelineBandSegment;
  top: number;
  pxPerMs: number;
  opacityFor?: MonitorTimelineDurationOpacity;
  hovered: boolean;
  selected: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
};

const MonitorTimelineBlock: Component<TimelineBlockProps> = (props) => {
  const isInstant = () => props.segment.endMs <= props.segment.startMs;
  const left = () => MONITOR_TIMELINE_LABEL_WIDTH + props.segment.startMs * props.pxPerMs;
  const width = () => {
    if (isInstant()) return 2;
    return Math.max(2, (props.segment.endMs - props.segment.startMs) * props.pxPerMs);
  };
  const height = () => (isInstant() ? MONITOR_TIMELINE_LANE_HEIGHT : MONITOR_TIMELINE_BLOCK_HEIGHT);
  const top = () => (isInstant() ? props.top - 4 : props.top);
  const color = () => MONITOR_TIMELINE_BAR_COLORS[props.segment.kind] ?? MONITOR_TIMELINE_BAR_FALLBACK;
  const showName = () => !isInstant() && width() >= 64;
  const opacity = () => {
    if (!props.opacityFor) return undefined;
    if (props.hovered) return 1;
    return props.opacityFor(props.segment.endMs - props.segment.startMs);
  };

  return (
    <button
      type="button"
      data-testid={`monitor-timeline-block-${props.segment.id}`}
      class={cn(
        'absolute cursor-pointer outline-none',
        isInstant() ? 'rounded-none shadow-none' : 'rounded-4 shadow-sm',
        color(),
        props.segment.isSubagent && !isInstant() && 'border border-surface/60',
        props.segment.running && !isInstant() && 'ui-monitor-timeline-running',
        (props.hovered || props.selected) && 'ring-2 ring-accent-solid',
        'focus-visible:ring-2 focus-visible:ring-accent-solid',
      )}
      style={{
        left: `${left()}px`,
        width: `${width()}px`,
        top: `${top()}px`,
        height: `${height()}px`,
        opacity: opacity(),
      }}
      onMouseEnter={() => props.onHover(props.segment.id)}
      onMouseLeave={() => props.onHover(null)}
      onClick={() => props.onSelect(props.segment.id)}
      aria-label={props.segment.name}
    >
      <Show when={showName()}>
        <span class="block truncate px-6 text-10 font-500 leading-16 text-white/90">
          {props.segment.isSubagent ? `▸ ${props.segment.name}` : props.segment.name}
        </span>
      </Show>
    </button>
  );
};

const MonitorTimelineHoverCard: Component<{
  hover: HoverState;
  width: number;
  traceNames?: string[];
}> = (props) => {
  const segment = () => props.hover.segment;
  const trace = () => {
    const index = segment().traceIndex;
    if (index === undefined || !props.traceNames?.[index]) return null;
    return {
      name: props.traceNames[index],
      color: MONITOR_TIMELINE_TRACE_COLORS[index % MONITOR_TIMELINE_TRACE_COLORS.length],
    };
  };
  const flipDown = () => props.hover.topPx < 96;
  const duration = () => formatMonitorLatency(segment().endMs - segment().startMs);

  return (
    <div
      class={cn(
        'pointer-events-none absolute z-50 w-(--container-popover) rounded-6 border border-border-subtle bg-surface p-8 text-11 shadow-lg',
        flipDown() ? 'translate-y-0' : '-translate-y-full',
      )}
      style={{
        left: `${Math.min(Math.max(props.hover.leftPx + 8, 8), props.width - 232)}px`,
        top: flipDown() ? `${props.hover.topPx + MONITOR_TIMELINE_LANE_HEIGHT + 6}px` : `${props.hover.topPx - 6}px`,
      }}
    >
      <div class="flex items-center gap-6">
        <MonitorObservationTypeIcon type={segment().kind} />
        <span class="truncate font-500 text-content-primary">{segment().name}</span>
      </div>
      <Show when={trace()}>
        {(entry) => (
          <div class="mt-4 flex items-center gap-6 text-11 text-content-secondary">
            <span class={cn('h-8 w-8 shrink-0 rounded-full', entry().color)} />
            <span class="truncate">{entry().name}</span>
          </div>
        )}
      </Show>
      <div class="mt-4 flex justify-between font-mono text-11 text-content-secondary">
        <span>+{segment().startMs}ms</span>
        <span>{segment().running ? 'running…' : duration()}</span>
      </div>
      <Show when={segment().tokens}>
        <div class="mt-2 flex items-center gap-6 text-11 text-content-muted">
          <span class="font-mono">{segment().tokens!.toLocaleString()} tok</span>
          <MonitorObservationLevelBadge level={segment().level} />
        </div>
      </Show>
      <Show when={segment().statusMessage}>
        <p class="mt-2 line-clamp-2 text-11 text-danger">{segment().statusMessage}</p>
      </Show>
    </div>
  );
};

export type MonitorTimelineBandProps = {
  groups: MonitorTimelineTypeLaneGroup[];
  totalMs: number;
  width: number;
  opacityFor?: MonitorTimelineDurationOpacity;
  traceNames?: string[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  class?: string;
  'data-testid'?: string;
};

/** T3 · 固定宽度时间带：按 type 分轨、lane 叠放、hover 卡片。 */
export const MonitorTimelineBand: Component<MonitorTimelineBandProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'groups',
    'totalMs',
    'width',
    'opacityFor',
    'traceNames',
    'selectedId',
    'onSelect',
    'class',
  ]);

  const [hoverId, setHoverId] = createSignal<string | null>(null);
  const timeWidth = () => Math.max(0, local.width - MONITOR_TIMELINE_LABEL_WIDTH);
  const pxPerMs = () => (timeWidth() > 0 ? timeWidth() / local.totalMs : 0);

  const placedGroups = () => {
    let cursor = 0;
    return local.groups.map((group) => {
      const topPx = cursor;
      cursor += group.laneCount * MONITOR_TIMELINE_LANE_HEIGHT + MONITOR_TIMELINE_GROUP_GAP;
      return { ...group, topPx };
    });
  };

  const totalHeight = () => {
    const groups = placedGroups();
    if (groups.length === 0) return 0;
    const last = groups[groups.length - 1];
    return last.topPx + last.laneCount * MONITOR_TIMELINE_LANE_HEIGHT;
  };

  const hoverState = (): HoverState | null => {
    const id = hoverId();
    if (!id) return null;
    for (const group of placedGroups()) {
      const segment = group.segments.find((item) => item.id === id);
      if (segment) {
        return {
          segment,
          leftPx: MONITOR_TIMELINE_LABEL_WIDTH + segment.startMs * pxPerMs(),
          topPx: group.topPx + segment.lane * MONITOR_TIMELINE_LANE_HEIGHT,
        };
      }
    }
    return null;
  };

  const gridStyle = () => {
    if (pxPerMs() <= 0) return undefined;
    const stepPx = monitorTimelineNiceTickStep(MONITOR_TIMELINE_TICK_TARGET_PX / pxPerMs()) * pxPerMs();
    return {
      'background-image': `repeating-linear-gradient(to right, var(--color-border-faint) 0 1px, transparent 1px ${stepPx}px)`,
    };
  };

  return (
    <div
      {...rest}
      class={cn('ui-monitor-timeline-band relative', local.class)}
      style={{ width: `${local.width}px`, height: `${totalHeight()}px` }}
    >
      <div
        class="absolute inset-y-0"
        style={{ left: `${MONITOR_TIMELINE_LABEL_WIDTH}px`, right: '0', ...gridStyle() }}
      />
      <For each={placedGroups()}>
        {(group) => (
          <div
            class="ui-monitor-timeline-type-row group absolute inset-x-0"
            style={{
              top: `${group.topPx}px`,
              height: `${group.laneCount * MONITOR_TIMELINE_LANE_HEIGHT}px`,
            }}
          >
            <div
              class="ui-monitor-timeline-track absolute inset-y-0"
              style={{ left: `${MONITOR_TIMELINE_LABEL_WIDTH}px`, right: '0' }}
            />
            <div
              class="absolute inset-y-0 left-0 flex items-center gap-6 border-r border-border-subtle pr-8"
              style={{ width: `${MONITOR_TIMELINE_LABEL_WIDTH}px` }}
            >
              <span
                class={cn(
                  'h-8 w-8 shrink-0 rounded-2',
                  MONITOR_TIMELINE_BAR_COLORS[group.kind] ?? MONITOR_TIMELINE_BAR_FALLBACK,
                )}
              />
              <span class="truncate text-10 font-600 uppercase text-content-secondary">
                {group.kind}
              </span>
            </div>
            <For each={group.segments}>
              {(segment) => (
                <MonitorTimelineBlock
                  segment={segment}
                  top={segment.lane * MONITOR_TIMELINE_LANE_HEIGHT + 4}
                  pxPerMs={pxPerMs()}
                  opacityFor={local.opacityFor}
                  hovered={hoverId() === segment.id}
                  selected={local.selectedId === segment.id}
                  onHover={setHoverId}
                  onSelect={(id) => local.onSelect?.(id)}
                />
              )}
            </For>
          </div>
        )}
      </For>
      <Show when={hoverState()}>
        {(hover) => (
          <MonitorTimelineHoverCard
            hover={hover()}
            width={local.width}
            traceNames={local.traceNames}
          />
        )}
      </Show>
    </div>
  );
};
