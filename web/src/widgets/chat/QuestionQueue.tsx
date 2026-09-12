import { Show, createEffect, createSignal } from 'solid-js';
import type { PendingQuestion, PendingQuestionItem } from '@/entities/chat/control-view';
import { createIdentitySelection } from '@/features/message/identity-selection';
import type { QuestionDeliveryState } from '@/features/message/question-delivery';
import type { QuestionAnswerPayload } from '@/shared/protocol/client';
import { Clock3 } from 'lucide-solid';
import type { QuestionnaireAnswer } from '@peri/ui';
import {
  AskUserQuestionnaireShell,
  type AskUserQuestionnaireStep,
} from './AskUserQuestionnaire';

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
  const steps = () => questionToSteps(props.question.questions);
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

  return (
    <AskUserQuestionnaireShell
      shellAriaLabel="Pending questions"
      testId="question-queue-card"
      steps={steps()}
      answers={answers()}
      onAnswersChange={syncAnswers}
      onSubmit={(record) => props.onRespond(props.question.questionId, answersToPayload(record, props.question.questions))}
      queueIndex={props.currentIndex}
      queueTotal={props.total}
      onQueuePrevious={props.onPrevious}
      onQueueNext={props.onNext}
      locked={locked()}
      submitting={submitting()}
      confirmed={confirmed()}
      uncertain={uncertain()}
      onRefreshStatus={props.onRefreshStatus}
      onDismissUncertain={props.onDismissUncertain}
      headerActions={(
        <Show when={props.question.expiresAt}>
          <span class="inline-flex items-center gap-4 text-10 text-text-muted">
            <Clock3 size={12} aria-hidden="true" />
            Expires soon
          </span>
        </Show>
      )}
    />
  );
}
