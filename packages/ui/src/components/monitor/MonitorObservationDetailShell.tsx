import { For, Show, splitProps, type Component } from 'solid-js';
import { ArrowLeft, X } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import { EmptyState } from '../EmptyState';
import {
  formatMonitorObservationDetailTokens,
  formatMonitorObservationDuration,
  formatMonitorObservationLevel,
  hasMonitorObservationDetails,
} from './format';
import {
  monitorDetailHeaderClass,
  monitorDetailTitleClass,
  monitorObservationDetailBodyClass,
  monitorObservationDetailLabelClass,
  monitorObservationDetailPreClass,
  monitorObservationDetailSectionClass,
  monitorObservationDetailTruncatedClass,
  monitorObservationDetailValueClass,
  monitorPanelClass,
} from './monitor-panel-layout';
import type { MonitorObservationView } from './types';

export type MonitorObservationDetailShellProps = {
  embedded?: boolean;
  observation: MonitorObservationView;
  onBack?: () => void;
  onClose?: () => void;
  class?: string;
  'data-testid'?: string;
};

type DetailField = {
  label: string;
  value: string;
};

function detailFields(observation: MonitorObservationView): DetailField[] {
  const fields: DetailField[] = [
    { label: 'Kind', value: observation.kind },
  ];
  const duration = formatMonitorObservationDuration(observation.latencyMs);
  if (duration) fields.push({ label: 'Duration', value: duration });
  fields.push({ label: 'Level', value: formatMonitorObservationLevel(observation.level) });
  if (observation.model) fields.push({ label: 'Model', value: observation.model });
  const tokens = formatMonitorObservationDetailTokens(observation);
  if (tokens) fields.push({ label: 'Tokens', value: tokens });
  if (observation.scoreValue) {
    fields.push({ label: 'Score', value: observation.scoreValue });
  }
  if (observation.scoreDataType) {
    fields.push({ label: 'Data type', value: observation.scoreDataType });
  }
  return fields;
}

/** T3 · Langfuse observation 详情壳（Back + 名称 + 有界 IO / score）。 */
export const MonitorObservationDetailShell: Component<MonitorObservationDetailShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'embedded',
    'observation',
    'onBack',
    'onClose',
    'class',
  ]);

  const rootClass = () => cn(
    monitorPanelClass,
    local.embedded ? 'min-h-0 flex-1' : 'h-full w-full',
    local.class,
  );

  const fields = () => detailFields(local.observation);
  const showEmpty = () => !hasMonitorObservationDetails(local.observation)
    && !local.observation.inputPreview
    && !local.observation.outputPreview;

  return (
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'monitor-observation-detail-shell'}
      class={rootClass()}
      aria-label="Observation detail"
    >
      <div class={monitorDetailHeaderClass}>
        <Show when={local.onBack}>
          {(back) => (
            <IconButton
              label="Back to observations"
              size="compact"
              variant="ghost"
              class="border-0 bg-transparent text-content-muted hover:text-content-primary"
              onClick={() => back()()}
            >
              <ArrowLeft size={14} strokeWidth={1.7} />
            </IconButton>
          )}
        </Show>
        <h2 class={monitorDetailTitleClass}>{local.observation.name}</h2>
        <Show when={local.onClose}>
          {(close) => (
            <IconButton
              label="Close observation detail"
              size="compact"
              variant="ghost"
              class="border-0 bg-transparent text-content-muted hover:text-content-primary"
              onClick={() => close()()}
            >
              <X size={14} strokeWidth={1.7} />
            </IconButton>
          )}
        </Show>
      </div>

      <div class={monitorObservationDetailBodyClass}>
        <Show
          when={!showEmpty()}
          fallback={(
            <EmptyState
              variant="inline"
              class="border-0 bg-transparent py-24"
              title="No details"
            />
          )}
        >
          <div class="flex flex-col gap-12">
            <div class="grid grid-cols-2 gap-x-12 gap-y-8">
              <For each={fields()}>
                {(field) => (
                  <div class={monitorObservationDetailSectionClass}>
                    <span class={monitorObservationDetailLabelClass}>{field.label}</span>
                    <span class={monitorObservationDetailValueClass}>{field.value}</span>
                  </div>
                )}
              </For>
            </div>

            <Show when={local.observation.inputPreview}>
              {(input) => (
                <div class={monitorObservationDetailSectionClass}>
                  <span class={monitorObservationDetailLabelClass}>Input</span>
                  <pre class={monitorObservationDetailPreClass} data-testid="monitor-observation-input">{input()}</pre>
                  <Show when={local.observation.inputTruncated}>
                    <span class={monitorObservationDetailTruncatedClass}>truncated</span>
                  </Show>
                </div>
              )}
            </Show>

            <Show when={local.observation.outputPreview}>
              {(output) => (
                <div class={monitorObservationDetailSectionClass}>
                  <span class={monitorObservationDetailLabelClass}>Output</span>
                  <pre class={monitorObservationDetailPreClass} data-testid="monitor-observation-output">{output()}</pre>
                  <Show when={local.observation.outputTruncated}>
                    <span class={monitorObservationDetailTruncatedClass}>truncated</span>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};
