import { createMemo, createSignal, onMount, Show, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { EmptyState } from '../EmptyState';
import { MonitorTimelineBand, MonitorTimelineRuler } from './MonitorTimelineBand';
import {
  buildMonitorTimelineDurationOpacity,
  layoutMonitorTimelineTypeLanes,
  MONITOR_TIMELINE_LABEL_WIDTH,
  type MonitorTimelineSegment,
} from './monitor-timeline-layout';

export type MonitorTimelineShellProps = {
  segments: MonitorTimelineSegment[];
  traceNames?: string[];
  heatmap?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** 测试 / SSR 可注入固定宽度，跳过 ResizeObserver。 */
  width?: number;
  class?: string;
  'data-testid'?: string;
};

/** T3 · 时间轴面板：ruler + band + 空态；宽度由容器 ResizeObserver 驱动。 */
export const MonitorTimelineShell: Component<MonitorTimelineShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'segments',
    'traceNames',
    'heatmap',
    'selectedId',
    'onSelect',
    'width',
    'class',
  ]);

  const [width, setWidth] = createSignal(local.width ?? 0);
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (local.width !== undefined) {
      setWidth(local.width);
      return;
    }
    const node = containerRef;
    if (!node || typeof ResizeObserver === 'undefined') {
      setWidth(Math.floor(node?.clientWidth ?? 640));
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(node);
    setWidth(Math.floor(node.clientWidth));
    return () => observer.disconnect();
  });

  const totalMs = createMemo(() => {
    const end = local.segments.reduce((max, segment) => Math.max(max, segment.endMs), 0);
    return Math.max(end, 1);
  });

  const groups = createMemo(() => layoutMonitorTimelineTypeLanes(local.segments, totalMs()));

  const opacityFor = createMemo(() => {
    if (!local.heatmap) return undefined;
    const boundary = totalMs();
    const durations = local.segments.map((segment) => {
      if (segment.running && segment.endMs <= segment.startMs) {
        return boundary - segment.startMs;
      }
      return segment.endMs - segment.startMs;
    });
    return buildMonitorTimelineDurationOpacity(durations);
  });

  const pxPerMs = () => {
    const timeWidth = Math.max(0, width() - MONITOR_TIMELINE_LABEL_WIDTH);
    return timeWidth > 0 ? timeWidth / totalMs() : 0;
  };

  return (
    <div
      {...rest}
      ref={containerRef}
      class={cn('ui-monitor-timeline flex min-h-0 flex-col', local.class)}
      data-testid={rest['data-testid'] ?? 'monitor-timeline-shell'}
    >
      <Show
        when={local.segments.length > 0}
        fallback={(
          <EmptyState
            variant="inline"
            title="No timeline data"
            description="Observations with timing will appear here."
          />
        )}
      >
        <MonitorTimelineRuler totalMs={totalMs()} pxPerMs={pxPerMs()} width={width()} />
        <div class="ui-scrollbar overflow-auto py-8">
          <MonitorTimelineBand
            groups={groups()}
            totalMs={totalMs()}
            width={width()}
            opacityFor={opacityFor()}
            traceNames={local.traceNames}
            selectedId={local.selectedId}
            onSelect={local.onSelect}
          />
        </div>
      </Show>
    </div>
  );
};
