import { For, Show, createEffect, createSignal } from 'solid-js';
import type { PendingQuestion, PendingQuestionItem } from '@/entities/chat/control-view';
import { createIdentitySelection } from '@/features/message/identity-selection';
import type { QuestionDeliveryState } from '@/features/message/question-delivery';
import type { QuestionAnswerPayload } from '@/shared/protocol/client';
import {
  Button,
  DecisionQueueShell,
  InlineNotice,
  Questionnaire,
  QuestionnaireNavigation,
  QuestionnaireStep,
  type QuestionnaireAnswer,
} from '@peri/ui';
import { Clock3, LockKeyhole } from 'lucide-solid';

interface Props {
  questions: PendingQuestion[];
  responses: Record<string, QuestionDeliveryState>;
  readOnly: boolean;
  onRefreshStatus: () => void;
  onDismissUncertain: (questionId: string) => void;
  onRespond: (questionId: string, answers: QuestionAnswerPayload[]) => void;
}

function questionStepId(index: number) {
  return `question-${index}`;
}

function draftToAnswers(
  draft: QuestionAnswerPayload[],
  questions: PendingQuestionItem[],
): Record<string, QuestionnaireAnswer> {
  const record: Record<string, QuestionnaireAnswer> = {};
  questions.forEach((_, index) => {
    const value = draft[index];
    if (value !== undefined) record[questionStepId(index)] = value;
  });
  return record;
}

function answersToPayload(
  answers: Record<string, QuestionnaireAnswer>,
  questions: PendingQuestionItem[],
): QuestionAnswerPayload[] {
  return questions.map((_, index) => {
    const value = answers[questionStepId(index)];
    if (value === null || value === undefined) return '';
    return value;
  });
}

function stepTitle(item: PendingQuestionItem) {
  return item.header || item.question;
}

function stepDescription(item: PendingQuestionItem) {
  return item.header ? item.question : undefined;
}

/** AskUserQuestion 队列；与 ACP elicitation 独立挂载。 */
export function QuestionQueue(props: Props) {
  const [drafts, setDrafts] = createSignal<Record<string, QuestionAnswerPayload[]>>({});
  const selection = createIdentitySelection(() => props.questions, (item) => item.questionId);
  return <Show when={selection.current()?.questionId} keyed>{(questionId) => {
    const item = () => selection.current()!;
    return <QuestionDialog
      question={item()}
      delivery={props.responses[questionId]}
      readOnly={props.readOnly}
      currentIndex={selection.index()}
      total={props.questions.length}
      initialAnswers={drafts()[questionId] ?? []}
      onDraft={(answers) => setDrafts((current) => ({ ...current, [questionId]: answers }))}
      onPrevious={() => selection.select(selection.index() - 1)}
      onNext={() => selection.select(selection.index() + 1)}
      onRefreshStatus={props.onRefreshStatus}
      onDismissUncertain={() => props.onDismissUncertain(questionId)}
      onRespond={props.onRespond}
    />;
  }}</Show>;
}

function QuestionDialog(props: {
  question: PendingQuestion;
  delivery?: QuestionDeliveryState;
  readOnly: boolean;
  currentIndex: number;
  total: number;
  initialAnswers: QuestionAnswerPayload[];
  onDraft: (answers: QuestionAnswerPayload[]) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRefreshStatus: () => void;
  onDismissUncertain: () => void;
  onRespond: Props['onRespond'];
}) {
  const [answers, setAnswers] = createSignal(
    draftToAnswers(props.initialAnswers, props.question.questions),
  );
  const submitting = () => props.delivery?.phase === 'pending';
  const confirmed = () => props.delivery?.phase === 'confirmed';
  const uncertain = () => props.delivery?.phase === 'failed'
    || props.delivery?.phase === 'uncertain'
    || props.delivery?.phase === 'delivery_unknown';
  const locked = () => (props.delivery?.phase === 'pending' || props.delivery?.phase === 'confirmed')
    || props.question.status === 'responding'
    || props.readOnly;

  createEffect(() => {
    setAnswers(draftToAnswers(props.initialAnswers, props.question.questions));
  });

  const syncAnswers = (next: Record<string, QuestionnaireAnswer>) => {
    setAnswers(next);
    props.onDraft(answersToPayload(next, props.question.questions));
  };

  const submitAnswers = (record: Record<string, QuestionnaireAnswer>) => {
    if (locked() || submitting() || confirmed()) return;
    const payload = answersToPayload(record, props.question.questions);
    for (let index = 0; index < props.question.questions.length; index += 1) {
      const skipped = record[questionStepId(index)] === null;
      if (skipped) continue;
      const value = payload[index];
      const empty = value === undefined
        || value === ''
        || (Array.isArray(value) && value.length === 0);
      if (empty) return;
    }
    props.onRespond(props.question.questionId, payload);
  };

  return (
    <DecisionQueueShell class="ui-chat-column pb-10" aria-label="Pending questions">
      <Show when={confirmed()}>
        <p class="my-4 text-12 text-text-secondary">Answers sent. Peri will continue when the server confirms.</p>
      </Show>
      <Show when={uncertain()}>
        <InlineNotice class="my-4" tone="warning" role="alert" title="Answer delivery not confirmed">
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
          data-testid="question-queue-card"
          title="Questions"
          currentIndex={props.currentIndex}
          total={props.total}
          onPrevious={props.onPrevious}
          onNext={props.onNext}
          pagerPreviousLabel="Previous question"
          pagerNextLabel="Next question"
          pagerShowNext={false}
          answers={answers()}
          onAnswersChange={syncAnswers}
          onSubmit={submitAnswers}
          aria-busy={submitting() ? 'true' : undefined}
          headerActions={(
            <Show when={props.question.expiresAt}>
              <span class="inline-flex items-center gap-4 text-10 text-text-muted">
                <Clock3 size={12} aria-hidden="true" />
                Expires soon
              </span>
            </Show>
          )}
        >
          <For each={props.question.questions}>
            {(item, index) => (
              <QuestionnaireStep
                id={questionStepId(index())}
                title={stepTitle(item)}
                description={stepDescription(item)}
                required
                multiple={item.multiSelect}
                choices={item.options.map((option) => ({
                  value: option.label,
                  label: option.label,
                  description: option.description ?? undefined,
                }))}
              />
            )}
          </For>
          <QuestionnaireNavigation
            skipDisabled={locked()}
            submitDisabled={locked()}
            submitBusy={submitting()}
          />
        </Questionnaire>
      </Show>
    </DecisionQueueShell>
  );
}
