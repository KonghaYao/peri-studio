import {
  MonitorObservationLevelBadge,
  MonitorObservationTypeBadge,
  MonitorTimelineBand,
  MonitorTimelineRuler,
  MonitorTimelineShell,
  layoutMonitorTimelineTypeLanes,
  MONITOR_TIMELINE_LABEL_WIDTH,
  type MonitorTimelineSegment,
} from '@peri/ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { DemoRow } from '@/pages/shared/DemoSection';

const DEMO_SEGMENTS: MonitorTimelineSegment[] = [
  { id: 'agent', name: 'agent-run', kind: 'AGENT', startMs: 0, endMs: 4200, level: 'DEFAULT' },
  { id: 'gen', name: 'step-1', kind: 'GENERATION', startMs: 400, endMs: 3600, tokens: 24140 },
  { id: 'gen-2', name: 'step-2', kind: 'GENERATION', startMs: 1800, endMs: 3000, tokens: 8200 },
  { id: 'tool', name: 'read_file', kind: 'TOOL', startMs: 1200, endMs: 2200 },
  { id: 'tool-2', name: 'grep', kind: 'TOOL', startMs: 1500, endMs: 1900 },
  {
    id: 'gen-run',
    name: 'stream-out',
    kind: 'GENERATION',
    startMs: 3200,
    endMs: 3200,
    running: true,
    tokens: 512,
  },
  { id: 'event', name: 'cache-miss', kind: 'EVENT', startMs: 3000, endMs: 3000, level: 'WARNING' },
];

const SUBAGENT_SEGMENTS: MonitorTimelineSegment[] = [
  {
    id: 'sub-agent',
    name: 'research-worker',
    kind: 'AGENT',
    startMs: 600,
    endMs: 3600,
    isSubagent: true,
    traceIndex: 1,
  },
  {
    id: 'sub-gen',
    name: 'summarize',
    kind: 'GENERATION',
    startMs: 900,
    endMs: 3200,
    isSubagent: true,
    tokens: 4200,
    traceIndex: 1,
  },
  {
    id: 'sub-tool',
    name: 'web_search',
    kind: 'TOOL',
    startMs: 1400,
    endMs: 2200,
    isSubagent: true,
    traceIndex: 1,
  },
];

const TIMELINE_WIDTH = 720;

/** T4 · Monitor timeline band demo（数据来自 peri-fuse observation timeline 契约）。 */
export function MonitorTimelineLayout() {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [subagentOpen, setSubagentOpen] = createSignal(true);

  const totalMs = createMemo(() => {
    const all = [...DEMO_SEGMENTS, ...SUBAGENT_SEGMENTS];
    const end = all.reduce((max, segment) => Math.max(max, segment.endMs), 0);
    return Math.max(end, 1);
  });

  const rootGroups = createMemo(() => layoutMonitorTimelineTypeLanes(DEMO_SEGMENTS, totalMs()));
  const subagentGroups = createMemo(() => layoutMonitorTimelineTypeLanes(SUBAGENT_SEGMENTS, totalMs()));

  const pxPerMs = () => {
    const timeWidth = Math.max(0, TIMELINE_WIDTH - MONITOR_TIMELINE_LABEL_WIDTH);
    return timeWidth > 0 ? timeWidth / totalMs() : 0;
  };

  return (
    <div class="flex flex-col gap-16">
      <DemoRow>
        <MonitorObservationTypeBadge type="GENERATION" />
        <MonitorObservationTypeBadge type="TOOL" />
        <MonitorObservationLevelBadge level="WARNING" />
      </DemoRow>
      <p class="text-11 text-content-muted">
        Ruler ticks align with the band grid. Hover a type row to highlight its track; hover a block
        for the detail card. Click to select (accent ring). Heatmap opacity scales with duration;
        running segments show diagonal stripes to the timeline edge.
      </p>
      <div class="h-300 rounded-8 border border-border-subtle bg-surface p-8">
        <MonitorTimelineShell
          segments={DEMO_SEGMENTS}
          width={TIMELINE_WIDTH}
          heatmap
          selectedId={selectedId()}
          onSelect={setSelectedId}
        />
      </div>

      <div class="rounded-8 border border-border-subtle bg-surface p-8">
        <p class="mb-8 text-11 text-content-muted">
          Subagent hierarchy uses a second band aligned to the same ruler. The anchor toggles the
          nested lane group; blocks prefixed with ▸ denote subagent observations.
        </p>
        <MonitorTimelineRuler totalMs={totalMs()} pxPerMs={pxPerMs()} width={TIMELINE_WIDTH} />
        <div class="ui-scrollbar overflow-auto py-8">
          <MonitorTimelineBand
            groups={rootGroups()}
            totalMs={totalMs()}
            width={TIMELINE_WIDTH}
            traceNames={['root-trace', 'research-worker']}
            selectedId={selectedId()}
            onSelect={setSelectedId}
          />
          <button
            type="button"
            class="mb-4 flex w-full items-center gap-6 rounded-4 px-8 py-4 text-left text-11 text-content-secondary transition-colors hover:bg-interaction-hover"
            onClick={() => setSubagentOpen((open) => !open)}
          >
            <span class="font-mono text-10 text-content-muted">{subagentOpen() ? '▾' : '▸'}</span>
            <span class="font-500">research-worker</span>
            <span class="text-content-muted">subagent trace</span>
          </button>
          <Show when={subagentOpen()}>
            <div class="border-l-2 border-border-subtle pl-8">
              <MonitorTimelineBand
                groups={subagentGroups()}
                totalMs={totalMs()}
                width={TIMELINE_WIDTH - 16}
                traceNames={['root-trace', 'research-worker']}
                selectedId={selectedId()}
                onSelect={setSelectedId}
              />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
