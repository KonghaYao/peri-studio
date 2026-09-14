import {
  IoPreviewCell,
  IoTabsShell,
  IoViewer,
  JsonTree,
  ScoreListShell,
  StatChip,
} from '@peri/ui';
import { Clock, Cpu } from 'lucide-solid';
import { For } from 'solid-js';
import { DemoRow } from '@/pages/shared/DemoSection';

const TABLE_ROWS = [
  {
    id: 'gen-1',
    name: 'step-1',
    input: { messages: [{ role: 'user', content: 'Summarize trace IO.' }] },
    output: { text: 'Use IoTabsShell with JsonTree slots.' },
  },
  {
    id: 'tool-1',
    name: 'read_file',
    input: { path: '/src/main.ts' },
    output: { bytes: 2048, truncated: true },
  },
];

const CHAT_INPUT = {
  messages: [
    { role: 'user', content: 'Explain monitor IO shells.' },
    { role: 'assistant', content: 'Preview tab content is injected by T4.' },
  ],
};

const METADATA = {
  traceId: 'tr_demo',
  tags: ['sandbox', 'monitor'],
  latencyMs: 1840,
};

const SCORES = [
  { id: 'acc', name: 'accuracy', source: 'EVAL', value: 0.9182 },
  { id: 'human', name: 'helpfulness', source: 'HUMAN', textValue: 'good' },
];

/** T4 · Monitor IO 表格预览 + 详情标签壳 + score 列表 demo。 */
export function MonitorIoDetailLayout() {
  return (
    <div class="flex flex-col gap-24">
      <DemoRow>
        <div class="flex w-full max-w-(--container-dialog-default) flex-col gap-8">
          <p class="text-11 text-content-muted">
            Table cells use IoPreviewCell with input/output surface tokens; click a cell to expand
            JsonTree in a dialog.
          </p>
          <div class="overflow-hidden rounded-8 border border-border-subtle">
            <table class="w-full border-collapse text-left text-12">
              <thead class="border-b border-border-subtle bg-surface-sunken text-11 text-content-muted">
                <tr>
                  <th class="px-12 py-8 font-600">Name</th>
                  <th class="px-12 py-8 font-600">Input</th>
                  <th class="px-12 py-8 font-600">Output</th>
                </tr>
              </thead>
              <tbody>
                <For each={TABLE_ROWS}>
                  {(row) => (
                    <tr class="border-b border-border-faint last:border-b-0">
                      <td class="px-12 py-8 font-600 text-content-primary">{row.name}</td>
                      <td class="px-12 py-8">
                        <IoPreviewCell data={row.input} variant="input" />
                      </td>
                      <td class="px-12 py-8">
                        <IoPreviewCell data={row.output} variant="output" />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      </DemoRow>

      <DemoRow>
        <div class="flex w-full max-w-(--container-dialog-default) flex-col gap-12">
          <div class="grid grid-cols-2 gap-8">
            <StatChip icon={<Clock size={14} />} label="Duration" value="1.84s" />
            <StatChip icon={<Cpu size={14} />} label="Model" value="gpt-4.1-mini" />
          </div>

          <IoTabsShell
            showPreviewTab
            renderPreview={() => (
              <p class="rounded-6 border border-border-subtle bg-surface-sunken px-12 py-8 text-12 text-content-secondary">
                T4 injects observation summary here; this shell stays domain-agnostic.
              </p>
            )}
            renderInput={() => <IoViewer data={CHAT_INPUT} />}
            renderOutput={() => (
              <JsonTree data={{ text: 'Monitor IO shells compose with slots.' }} />
            )}
            renderMetadata={() => <JsonTree data={METADATA} defaultCollapsedDepth={1} />}
          />

          <div>
            <h3 class="mb-8 text-12 font-600 text-content-primary">Scores</h3>
            <ScoreListShell scores={SCORES} />
          </div>
        </div>
      </DemoRow>
    </div>
  );
}
