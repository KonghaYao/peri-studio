import { For, Show, type JSX } from 'solid-js';
import { read, type MaybeAccessor } from '@/shared/lib/maybe-accessor';
import {
  Button,
  DecisionQueueShell,
  InlineNotice,
  Questionnaire,
  QuestionnaireNavigation,
  QuestionnaireStep,
  type QuestionnaireAnswer,
  chatColumnClass,
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
  steps: MaybeAccessor<AskUserQuestionnaireStep[]>;
  answers: Record<string, QuestionnaireAnswer>;
  onAnswersChange: (answers: Record<string, QuestionnaireAnswer>) => void;
  onSubmit: (answers: Record<string, QuestionnaireAnswer>) => void;
  /** 整题 Skip（如 elicitation decline）；未提供时 Skip 仅跳过当前子题。 */
  onSkip?: () => void;
  queueIndex: MaybeAccessor<number>;
  queueTotal: MaybeAccessor<number>;
  onQueuePrevious: () => void;
  onQueueNext: () => void;
  locked: MaybeAccessor<boolean>;
  submitting: MaybeAccessor<boolean>;
  confirmed: MaybeAccessor<boolean>;
  uncertain: MaybeAccessor<boolean>;
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
  const steps = () => read(props.steps);
  const queueIndex = () => read(props.queueIndex);
  const queueTotal = () => read(props.queueTotal);
  const locked = () => read(props.locked);
  const submitting = () => read(props.submitting);
  const confirmed = () => read(props.confirmed);
  const uncertain = () => read(props.uncertain);
  const submitAnswers = (record: Record<string, QuestionnaireAnswer>) => {
    if (locked() || submitting() || confirmed()) return;
    if (!canSubmit(record, steps())) return;
    props.onSubmit(record);
  };

  return (
    <DecisionQueueShell class={`${chatColumnClass} pb-10`} aria-label={props.shellAriaLabel}>
      <Show when={confirmed()}>
        <p class="my-4 text-12 text-text-secondary">Answers sent. Peri will continue when the server confirms.</p>
      </Show>
      <Show when={uncertain()}>
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
      <Show when={!confirmed() && !uncertain()}>
        <Show when={locked()}>
          <p class="mb-8 inline-flex items-center gap-6 text-11 text-text-muted">
            <LockKeyhole size={12} aria-hidden="true" />
            Waiting for server confirmation
          </p>
        </Show>
        <Questionnaire
          class="mx-auto w-full max-w-(--container-search)"
          data-testid={props.testId}
          title="Questions"
          currentIndex={queueIndex()}
          total={queueTotal()}
          onPrevious={props.onQueuePrevious}
          onNext={props.onQueueNext}
          pagerPreviousLabel="Previous question"
          pagerNextLabel="Next question"
          pagerShowNext={queueTotal() > 1}
          answers={props.answers}
          onAnswersChange={props.onAnswersChange}
          onSubmit={submitAnswers}
          aria-busy={submitting() ? 'true' : undefined}
          headerActions={props.headerActions}
        >
          <For each={steps()}>
            {(stepItem) => {
              const step = () => read(stepItem);
              return (
                <QuestionnaireStep
                  id={step().id}
                  title={step().title}
                  description={step().description}
                  required={step().required}
                  multiple={step().multiple}
                  allowText={step().allowText}
                  textLabel={step().textLabel}
                  textPlaceholder={step().textPlaceholder}
                  choices={step().choices}
                />
              );
            }}
          </For>
          <QuestionnaireNavigation
            onSkip={props.onSkip}
            skipDisabled={locked()}
            submitDisabled={locked()}
            submitBusy={submitting()}
          />
        </Questionnaire>
      </Show>
    </DecisionQueueShell>
  );
}
