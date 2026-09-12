import { Show, createEffect, createSignal } from 'solid-js';
import type { ElicitationField, PendingElicitation } from '@/entities/chat/control-view';
import { createIdentitySelection } from '@/features/message/identity-selection';
import type { ElicitationDeliveryState } from '@/features/message/elicitation-delivery';
import type { ElicitationAnswer } from '@/shared/protocol/client';
import type { QuestionnaireAnswer } from '@peri/ui';
import {
  AskUserQuestionnaireShell,
  type AskUserQuestionnaireStep,
} from './AskUserQuestionnaire';

interface Props {
  elicitations: PendingElicitation[];
  responses: Record<string, ElicitationDeliveryState>;
  readOnly: boolean;
  onRefreshStatus: () => void;
  onDismissUncertain: (elicitationId: string) => void;
  onRespond: (
    elicitationId: string,
    action: 'accept' | 'decline' | 'cancel',
    answers?: Record<string, ElicitationAnswer>,
  ) => void;
}

function fieldToStep(field: ElicitationField): AskUserQuestionnaireStep {
  const choices = field.kind === 'text'
    ? undefined
    : field.options.map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description ?? undefined,
    }));

  return {
    id: field.id,
    title: field.title,
    description: field.description ?? undefined,
    required: field.required,
    multiple: field.kind === 'multi_select',
    allowText: field.kind === 'text',
    textLabel: field.title,
    choices,
  };
}

function elicitationToSteps(elicitation: PendingElicitation): AskUserQuestionnaireStep[] {
  return elicitation.fields.map(fieldToStep);
}

function recordToElicitationAnswers(
  record: Record<string, QuestionnaireAnswer>,
  fields: ElicitationField[],
): Record<string, ElicitationAnswer> {
  const answers: Record<string, ElicitationAnswer> = {};
  for (const field of fields) {
    const value = record[field.id];
    if (value === null || value === undefined) continue;
    answers[field.id] = value;
  }
  return answers;
}

/** ACP elicitation/create；与 interactive_question 共用多步 Questionnaire 壳。 */
export function ElicitationQueue(props: Props) {
  const [drafts, setDrafts] = createSignal<Record<string, Record<string, ElicitationAnswer>>>({});
  const selection = createIdentitySelection(() => props.elicitations, (item) => item.elicitationId);
  return <Show when={selection.current()?.elicitationId} keyed>{(elicitationId) => {
    const item = () => selection.current()!;
    return <ElicitationDialog
      elicitation={item()}
      delivery={props.responses[elicitationId]}
      readOnly={props.readOnly}
      currentIndex={selection.index()}
      total={props.elicitations.length}
      initialAnswers={drafts()[elicitationId] ?? {}}
      onDraft={(answers) => setDrafts((current) => ({ ...current, [elicitationId]: answers }))}
      onPrevious={() => selection.select(selection.index() - 1)}
      onNext={() => selection.select(selection.index() + 1)}
      onRefreshStatus={props.onRefreshStatus}
      onDismissUncertain={() => props.onDismissUncertain(elicitationId)}
      onRespond={props.onRespond}
    />;
  }}</Show>;
}

function ElicitationDialog(props: {
  elicitation: PendingElicitation;
  delivery?: ElicitationDeliveryState;
  readOnly: boolean;
  currentIndex: number;
  total: number;
  initialAnswers: Record<string, ElicitationAnswer>;
  onDraft: (answers: Record<string, ElicitationAnswer>) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRefreshStatus: () => void;
  onDismissUncertain: () => void;
  onRespond: Props['onRespond'];
}) {
  const steps = () => elicitationToSteps(props.elicitation);
  const [answers, setAnswers] = createSignal<Record<string, QuestionnaireAnswer>>(props.initialAnswers);

  const submitting = () => props.delivery?.phase === 'pending';
  const confirmed = () => props.delivery?.phase === 'confirmed';
  const uncertain = () => props.delivery?.phase === 'failed'
    || props.delivery?.phase === 'uncertain'
    || props.delivery?.phase === 'delivery_unknown';
  const locked = () => (props.delivery?.phase === 'pending' || props.delivery?.phase === 'confirmed')
    || props.elicitation.status === 'responding'
    || props.readOnly;

  createEffect(() => {
    setAnswers(props.initialAnswers);
  });

  const syncAnswers = (next: Record<string, QuestionnaireAnswer>) => {
    setAnswers(next);
    props.onDraft(recordToElicitationAnswers(next, props.elicitation.fields));
  };

  return (
    <AskUserQuestionnaireShell
      shellAriaLabel="Agent question"
      testId="elicitation-card"
      steps={steps()}
      answers={answers()}
      onAnswersChange={syncAnswers}
      onSubmit={(record) => props.onRespond(
        props.elicitation.elicitationId,
        'accept',
        recordToElicitationAnswers(record, props.elicitation.fields),
      )}
      onSkip={() => props.onRespond(props.elicitation.elicitationId, 'decline')}
      queueIndex={props.currentIndex}
      queueTotal={props.total}
      onQueuePrevious={props.onPrevious}
      onQueueNext={props.onNext}
      locked={locked()}
      submitting={submitting()}
      confirmed={confirmed()}
      uncertain={uncertain()}
      uncertainTitle={props.delivery?.phase === 'failed' ? 'Answer was not accepted' : 'Answer delivery not confirmed'}
      onRefreshStatus={props.onRefreshStatus}
      onDismissUncertain={props.onDismissUncertain}
    />
  );
}
