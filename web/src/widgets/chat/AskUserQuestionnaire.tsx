import { For, Show, type JSX } from 'solid-js';
import {
  Button,
  DecisionQueueShell,
  InlineNotice,
  Questionnaire,
  QuestionnaireNavigation,
  QuestionnaireStep,
  type QuestionnaireAnswer,
} from '@peri/ui';
import { LockKeyhole } from 'lucide-solid';

export type AskUserQuestionnaireStep = {
  id: string;
  title: string;
  description?: string;
  required?: boolean;
  multiple?: boolean;
  allowText?: boolean;
  textLabel?: string;
  textPlaceholder?: string;
  choices?: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
};

export type AskUserQuestionnaireShellProps = {
  shellAriaLabel: string;
  testId: string;
  steps: AskUserQuestionnaireStep[];
  answers: Record<string, QuestionnaireAnswer>;
  onAnswersChange: (answers: Record<string, QuestionnaireAnswer>) => void;
  onSubmit: (answers: Record<string, QuestionnaireAnswer>) => void;
  /** 整题 Skip（如 elicitation decline）；未提供时 Skip 仅跳过当前子题。 */
  onSkip?: () => void;
  queueIndex: number;
  queueTotal: number;
  onQueuePrevious: () => void;
  onQueueNext: () => void;
  locked: boolean;
  submitting: boolean;
  confirmed: boolean;
  uncertain: boolean;
  uncertainTitle?: string;
  onRefreshStatus: () => void;
  onDismissUncertain: () => void;
  headerActions?: JSX.Element;
};

function canSubmit(
  record: Record<string, QuestionnaireAnswer>,
  steps: AskUserQuestionnaireStep[],
): boolean {
  for (const step of steps) {
    if (record[step.id] === null) continue;
    if (!step.required) continue;
    const value = record[step.id];
    const empty = value === undefined
      || value === ''
      || (Array.isArray(value) && value.length === 0);
    if (empty) return false;
  }
  return true;
}

/** AskUserQuestion 多步问卷共用壳（QuestionQueue / ElicitationQueue）。 */
export function AskUserQuestionnaireShell(props: AskUserQuestionnaireShellProps) {
  const submitAnswers = (record: Record<string, QuestionnaireAnswer>) => {
    if (props.locked || props.submitting || props.confirmed) return;
    if (!canSubmit(record, props.steps)) return;
    props.onSubmit(record);
  };

  return (
    <DecisionQueueShell class="ui-chat-column pb-10" aria-label={props.shellAriaLabel}>
      <Show when={props.confirmed}>
        <p class="my-4 text-12 text-text-secondary">Answers sent. Peri will continue when the server confirms.</p>
      </Show>
      <Show when={props.uncertain}>
        <InlineNotice
          class="my-4"
          tone="warning"
          role="alert"
          title={props.uncertainTitle ?? 'Answer delivery not confirmed'}
        >
          <p class="my-4">Refresh the server status, or hide this question locally. The original answer cannot be sent again.</p>
          <div class="flex flex-wrap gap-8">
            <Button type="button" size="compact" variant="secondary" onClick={props.onRefreshStatus}>Refresh status</Button>
            <Button type="button" size="compact" variant="secondary" class="pointer-coarse:min-h-44!" onClick={props.onDismissUncertain}>Hide question</Button>
          </div>
        </InlineNotice>
      </Show>
      <Show when={!props.confirmed && !props.uncertain}>
        <Show when={props.locked}>
          <p class="mb-8 inline-flex items-center gap-6 text-11 text-text-muted">
            <LockKeyhole size={12} aria-hidden="true" />
            Waiting for server confirmation
          </p>
        </Show>
        <Questionnaire
          class="mx-auto w-full max-w-(--container-search)"
          data-testid={props.testId}
          title="Questions"
          currentIndex={props.queueIndex}
          total={props.queueTotal}
          onPrevious={props.onQueuePrevious}
          onNext={props.onQueueNext}
          pagerPreviousLabel="Previous question"
          pagerNextLabel="Next question"
          pagerShowNext={props.queueTotal > 1}
          answers={props.answers}
          onAnswersChange={props.onAnswersChange}
          onSubmit={submitAnswers}
          aria-busy={props.submitting ? 'true' : undefined}
          headerActions={props.headerActions}
        >
          <For each={props.steps}>
            {(step) => (
              <QuestionnaireStep
                id={step.id}
                title={step.title}
                description={step.description}
                required={step.required}
                multiple={step.multiple}
                allowText={step.allowText}
                textLabel={step.textLabel}
                textPlaceholder={step.textPlaceholder}
                choices={step.choices}
              />
            )}
          </For>
          <QuestionnaireNavigation
            onSkip={props.onSkip}
            skipDisabled={props.locked}
            submitDisabled={props.locked}
            submitBusy={props.submitting}
          />
        </Questionnaire>
      </Show>
    </DecisionQueueShell>
  );
}
