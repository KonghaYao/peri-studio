import {
  IoTabsShell,
  JsonTree,
  MonitorObservationTypeBadge,
  MonitorTraceTurnTree,
  MonitorTraceTurnTreeShell,
  type MonitorTraceObservationFlat,
} from '@peri/ui';
import { createSignal, Show } from 'solid-js';
import { DemoRow } from '@/pages/shared/DemoSection';

const TURN_ONE: MonitorTraceObservationFlat[] = [
  {
    id: 'agent-1',
    parentId: null,
    type: 'AGENT',
    name: 'agent-run',
    startTime: '2025-03-04T10:00:00.000Z',
    endTime: '2025-03-04T10:00:12.400Z',
    level: 'DEFAULT',
  },
  {
    id: 'stage-reason-1',
    parentId: 'agent-1',
    type: 'SPAN',
    name: 'stage-reason',
    startTime: '2025-03-04T10:00:00.500Z',
    endTime: '2025-03-04T10:00:06.200Z',
    level: 'DEFAULT',
  },
  {
    id: 'plan-1',
    parentId: 'stage-reason-1',
    type: 'GENERATION',
    name: 'plan-step',
    startTime: '2025-03-04T10:00:01.000Z',
    endTime: '2025-03-04T10:00:06.100Z',
    level: 'DEFAULT',
    inputTokens: 18240,
    outputTokens: 96,
  },
  {
    id: 'stage-act-1',
    parentId: 'agent-1',
    type: 'SPAN',
    name: 'stage-act',
    startTime: '2025-03-04T10:00:06.300Z',
    endTime: '2025-03-04T10:00:12.200Z',
    level: 'DEFAULT',
  },
  {
    id: 'tool-batch-1',
    parentId: 'stage-act-1',
    type: 'SPAN',
    name: 'tool-batch',
    startTime: '2025-03-04T10:00:06.500Z',
    endTime: '2025-03-04T10:00:08.000Z',
    level: 'DEFAULT',
  },
  {
    id: 'read-file-1',
    parentId: 'tool-batch-1',
    type: 'TOOL',
    name: 'read_file',
    startTime: '2025-03-04T10:00:06.600Z',
    endTime: '2025-03-04T10:00:07.420Z',
    level: 'DEFAULT',
    output: { path: '/src/monitor/tree.ts', bytes: 4096 },
  },
  {
    id: 'respond-1',
    parentId: 'stage-act-1',
    type: 'GENERATION',
    name: 'respond',
    startTime: '2025-03-04T10:00:08.100Z',
    endTime: '2025-03-04T10:00:12.100Z',
    level: 'DEFAULT',
    inputTokens: 20100,
    outputTokens: 180,
  },
];

const TURN_TWO: MonitorTraceObservationFlat[] = [
  {
    id: 'agent-2',
    parentId: null,
    type: 'AGENT',
    name: 'agent-run',
    startTime: '2025-03-04T10:00:13.000Z',
    endTime: '2025-03-04T10:00:18.500Z',
    level: 'DEFAULT',
  },
  {
    id: 'summarize-2',
    parentId: 'agent-2',
    type: 'GENERATION',
    name: 'summarize',
    startTime: '2025-03-04T10:00:13.500Z',
    endTime: '2025-03-04T10:00:18.200Z',
    level: 'DEFAULT',
    inputTokens: 9600,
    outputTokens: 240,
  },
];

/** 额外 turn：足够节点验证 observation tree 在固定高度分栏内滚动。 */
const TURN_SCROLL: MonitorTraceObservationFlat[] = (() => {
  const agentId = 'agent-scroll';
  const stageId = 'stage-scroll-act';
  const batchId = 'tool-batch-scroll';
  const rows: MonitorTraceObservationFlat[] = [
    {
      id: agentId,
      parentId: null,
      type: 'AGENT',
      name: 'agent-run',
      startTime: '2025-03-04T10:00:19.000Z',
      endTime: '2025-03-04T10:00:45.000Z',
      level: 'DEFAULT',
    },
    {
      id: stageId,
      parentId: agentId,
      type: 'SPAN',
      name: 'stage-act',
      startTime: '2025-03-04T10:00:19.200Z',
      endTime: '2025-03-04T10:00:44.800Z',
      level: 'DEFAULT',
    },
    {
      id: batchId,
      parentId: stageId,
      type: 'SPAN',
      name: 'tool-batch',
      startTime: '2025-03-04T10:00:19.400Z',
      endTime: '2025-03-04T10:00:40.000Z',
      level: 'DEFAULT',
    },
  ];

  for (let index = 0; index < 18; index += 1) {
    rows.push({
      id: `scroll-tool-${index}`,
      parentId: batchId,
      type: 'TOOL',
      name: `read_file_${index}`,
      startTime: `2025-03-04T10:00:${20 + index}.000Z`,
      endTime: `2025-03-04T10:00:${20 + index}.420Z`,
      level: 'DEFAULT',
      output: { path: `/src/module/file-${index}.ts`, bytes: 1024 + index },
    });
  }

  rows.push({
    id: 'scroll-respond',
    parentId: stageId,
    type: 'GENERATION',
    name: 'respond',
    startTime: '2025-03-04T10:00:40.500Z',
    endTime: '2025-03-04T10:00:44.700Z',
    level: 'DEFAULT',
    inputTokens: 18200,
    outputTokens: 320,
  });

  return rows;
})();

const ALL_OBSERVATIONS = [...TURN_ONE, ...TURN_TWO, ...TURN_SCROLL];

function findObservation(id: string | null): MonitorTraceObservationFlat | null {
  if (!id) return null;
  return ALL_OBSERVATIONS.find((item) => item.id === id) ?? null;
}

/** T4 · trace 全量 turn 树 + 详情分栏 demo。 */
export function MonitorTraceTurnTreeLayout() {
  const [selectedId, setSelectedId] = createSignal<string | null | undefined>(undefined);
  const [omitNoise, setOmitNoise] = createSignal(true);

  const selected = () => findObservation(selectedId() ?? null);
  const showPlaceholder = () => selectedId() === undefined;

  return (
    <div class="flex flex-col gap-16">
      <DemoRow>
        <div class="flex h-360 min-h-0 w-full max-w-(--container-settings-panel) flex-col overflow-hidden rounded-8 border border-border-subtle">
          <MonitorTraceTurnTreeShell
            class="min-h-0 flex-1"
            tree={(
              <MonitorTraceTurnTree
                turns={[
                  { id: 'turn-1', label: 'Turn 1', observations: TURN_ONE },
                  { id: 'turn-2', label: 'Turn 2', observations: TURN_TWO },
                  { id: 'turn-3', label: 'Turn 3', observations: TURN_SCROLL },
                ]}
                omitNoise={omitNoise()}
                onOmitNoiseChange={setOmitNoise}
                showOmitNoiseToggle
                traceRoot={{ name: 'sandbox-trace', latencyMs: 18500 }}
                selectedTraceRoot={selectedId() === null}
                selectedId={typeof selectedId() === 'string' ? selectedId() : null}
                onTraceRootSelect={() => setSelectedId(null)}
                onSelect={(id) => setSelectedId(id)}
                enableKeyboardNav
              />
            )}
            showDetailPlaceholder={showPlaceholder()}
            detail={(
              <Show
                when={selectedId() === null}
                fallback={(
                  <Show when={selected()} keyed>
                    {(observation) => (
                      <div class="flex flex-col gap-12">
                        <div class="flex flex-wrap items-center gap-8">
                          <h4 class="text-14 font-600 text-content-primary">{observation.name}</h4>
                          <MonitorObservationTypeBadge type={observation.type} />
                        </div>
                        <IoTabsShell
                          renderInput={() => (
                            <JsonTree
                              data={observation.inputTokens ? { tokens: observation.inputTokens } : null}
                            />
                          )}
                          renderOutput={() => (
                            <JsonTree
                              data={observation.output ?? { tokens: observation.outputTokens }}
                            />
                          )}
                          renderMetadata={() => (
                            <JsonTree data={{ id: observation.id, level: observation.level }} />
                          )}
                        />
                      </div>
                    )}
                  </Show>
                )}
              >
                <div class="flex flex-col gap-8">
                  <h4 class="text-14 font-600 text-content-primary">Trace root</h4>
                  <p class="text-12 text-content-secondary">
                    Two agent turns with nested stage / tool / generation spans. Noise filter hides
                    stage-* wrappers by default.
                  </p>
                  <JsonTree data={{ trace: 'sandbox-trace', turns: 3, observations: ALL_OBSERVATIONS.length }} />
                </div>
              </Show>
            )}
          />
        </div>
      </DemoRow>
    </div>
  );
}
