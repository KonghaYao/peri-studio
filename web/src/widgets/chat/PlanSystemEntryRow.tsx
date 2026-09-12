import { For, Show } from 'solid-js';
import type { ChatEntry } from '@/entities/chat/chat-view';
import { isPlanSystemChatEntry } from '@/entities/chat/plan-system-entry';
import { mapPlanStepStatus } from '@/features/chat/plan-step-status';
import {
  Plan,
  PlanContent,
  PlanHeader,
  PlanStep,
  PlanTitle,
} from '@peri/ui';

/** Chat timeline row for `plan:{turn|global}` system entries (Control plan stays in StatusArea). */
export function PlanSystemEntryRow(props: { entry: ChatEntry }) {
  const entries = () => props.entry.planEntries ?? [];
  return (
    <Show when={isPlanSystemChatEntry(props.entry) && entries().length > 0}>
      <Plan
        class="mx-auto w-full max-w-(--chat-content-max)"
        defaultOpen
        data-testid="plan-system-entry"
        aria-label="Agent plan"
      >
        <PlanHeader class="min-h-34 border-b border-divider px-10 py-6">
          <PlanTitle class="text-11 font-650 text-text-primary">Plan</PlanTitle>
        </PlanHeader>
        <PlanContent class="grid gap-4 p-8">
          <For each={entries()}>{(entry) => (
            <PlanStep
              status={mapPlanStepStatus(entry.status)}
              label={entry.status === 'in_progress' && entry.activeForm ? entry.activeForm : entry.content}
            />
          )}</For>
        </PlanContent>
      </Plan>
    </Show>
  );
}
