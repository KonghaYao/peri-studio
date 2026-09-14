import { Show, createEffect, createSignal } from 'solid-js';
import type { PendingQuestion, PendingQuestionItem } from '@/entities/chat/control-view';
import { createIdentitySelection } from '@/features/message/identity-selection';
import type { QuestionDeliveryState } from '@/features/message/question-delivery';
import type { QuestionAnswerPayload } from '@/shared/protocol/client';
import { read, type MaybeAccessor } from '@/shared/lib/maybe-accessor';
import { Clock3 } from 'lucide-solid';
import type { QuestionnaireAnswer } from '@peri/ui';
import {
  AskUserQuestionnaireShell,
  type AskUserQuestionnaireStep,
} from './AskUserQuestionnaire';

interface Props {
  questions: MaybeAccessor<PendingQuestion[]>;
  responses: MaybeAccessor<Record<string, QuestionDeliveryState>>;
  readOnly: MaybeAccessor<boolean>;
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

function questionToSteps(questions: PendingQuestionItem[]): AskUserQuestionnaireStep[] {
  return questions.map((item, index) => ({
    id: questionStepId(index),
    title: stepTitle(item),
    description: stepDescription(item),
    required: true,
    multiple: item.multiSelect,
    choices: item.options.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description ?? undefined,
    })),
  }));
}

/** AskUserQuestion 队列（interactive_question）。 */
export function QuestionQueue(props: Props) {
  const questions = () => read(props.questions);
  const responses = () => read(props.responses);
  const readOnly = () => read(props.readOnly);
  const [drafts, setDrafts] = createSignal<Record<string, QuestionAnswerPayload[]>>({});
  const selection = createIdentitySelection(questions, (item) => item.questionId);
  return <Show when={selection.current()?.questionId} keyed>{(questionId) => {
    const item = () => selection.current()!;
    return <QuestionDialog
      question={item}
      delivery={() => responses()[questionId]}
      readOnly={readOnly}
      currentIndex={selection.index}
      total={() => questions().length}
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
  question: MaybeAccessor<PendingQuestion>;
  delivery?: MaybeAccessor<QuestionDeliveryState | undefined>;
  readOnly: MaybeAccessor<boolean>;
  currentIndex: MaybeAccessor<number>;
  total: MaybeAccessor<number>;
  initialAnswers: QuestionAnswerPayload[];
  onDraft: (answers: QuestionAnswerPayload[]) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRefreshStatus: () => void;
  onDismissUncertain: () => void;
  onRespond: Props['onRespond'];
}) {
  const question = () => read(props.question);
  const readOnly = () => read(props.readOnly);
  const currentIndex = () => read(props.currentIndex);
  const total = () => read(props.total);
  const delivery = () => (props.delivery === undefined ? undefined : read(props.delivery));
  const steps = () => questionToSteps(question().questions);
  const [answers, setAnswers] = createSignal(
    draftToAnswers(props.initialAnswers, question().questions),
  );
  const submitting = () => delivery()?.phase === 'pending';
  const confirmed = () => delivery()?.phase === 'confirmed';
  const uncertain = () => delivery()?.phase === 'failed'
    || delivery()?.phase === 'uncertain'
    || delivery()?.phase === 'delivery_unknown';
  const locked = () => (delivery()?.phase === 'pending' || delivery()?.phase === 'confirmed')
    || question().status === 'responding'
    || readOnly();

  createEffect(() => {
    setAnswers(draftToAnswers(props.initialAnswers, question().questions));
  });

  const syncAnswers = (next: Record<string, QuestionnaireAnswer>) => {
    setAnswers(next);
    props.onDraft(answersToPayload(next, question().questions));
  };

  return (
    <AskUserQuestionnaireShell
      shellAriaLabel="Pending questions"
      testId="question-queue-card"
      steps={steps}
      answers={answers()}
      onAnswersChange={syncAnswers}
      onSubmit={(record) => props.onRespond(question().questionId, answersToPayload(record, question().questions))}
      queueIndex={currentIndex}
      queueTotal={total}
      onQueuePrevious={props.onPrevious}
      onQueueNext={props.onNext}
      locked={locked}
      submitting={submitting}
      confirmed={confirmed}
      uncertain={uncertain}
      onRefreshStatus={props.onRefreshStatus}
      onDismissUncertain={props.onDismissUncertain}
      headerActions={(
        <Show when={question().expiresAt}>
          <span class="inline-flex items-center gap-4 text-10 text-text-muted">
            <Clock3 size={12} aria-hidden="true" />
            Expires soon
          </span>
        </Show>
      )}
    />
  );
}
