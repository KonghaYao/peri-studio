import { For, Show, createSignal, createUniqueId } from 'solid-js';
import type { PendingQuestion } from '@/entities/chat/control-view';
import { createIdentitySelection } from '@/features/message/identity-selection';
import type { QuestionDeliveryState } from '@/features/message/question-delivery';
import type { QuestionAnswerPayload } from '@/shared/protocol/client';
import {
  Button,
  Checkbox,
  CheckboxControl,
  CheckboxInput,
  CheckboxLabel,
  RadioGroup,
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
} from '@peri/ui';
import { Clock3, LockKeyhole } from 'lucide-solid';
import { DecisionCard } from './DecisionCard';

interface Props {
  questions: PendingQuestion[];
  responses: Record<string, QuestionDeliveryState>;
  readOnly: boolean;
  onRefreshStatus: () => void;
  onDismissUncertain: (questionId: string) => void;
  onRespond: (questionId: string, answers: QuestionAnswerPayload[]) => void;
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
  const [answers, setAnswers] = createSignal<QuestionAnswerPayload[]>(props.initialAnswers);
  const [validation, setValidation] = createSignal('');
  const bodyId = `question-body-${createUniqueId()}`;
  const submitting = () => props.delivery?.phase === 'pending';
  const confirmed = () => props.delivery?.phase === 'confirmed';
  const uncertain = () => props.delivery?.phase === 'failed'
    || props.delivery?.phase === 'uncertain'
    || props.delivery?.phase === 'delivery_unknown';
  const locked = () => !!props.delivery || props.question.status === 'responding' || props.readOnly;

  const syncAnswers = (next: QuestionAnswerPayload[]) => {
    setAnswers(next);
    props.onDraft(next);
    setValidation('');
  };

  const answerAt = (index: number): QuestionAnswerPayload | undefined => answers()[index];

  const setSingle = (index: number, label: string) => {
    const next = [...answers()];
    while (next.length <= index) next.push('');
    next[index] = label;
    syncAnswers(next);
  };

  const toggleMulti = (index: number, label: string) => {
    const next = [...answers()];
    while (next.length <= index) next.push([]);
    const current = next[index];
    const selected = Array.isArray(current) ? [...current] : [];
    const pos = selected.indexOf(label);
    if (pos >= 0) selected.splice(pos, 1);
    else selected.push(label);
    next[index] = selected;
    syncAnswers(next);
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const payload: QuestionAnswerPayload[] = [];
    for (let index = 0; index < props.question.questions.length; index += 1) {
      const item = props.question.questions[index];
      const value = answerAt(index);
      const empty = value === undefined
        || value === ''
        || (Array.isArray(value) && value.length === 0);
      if (empty) {
        setValidation(`Please answer "${item.header || item.question}" first`);
        return;
      }
      payload.push(value);
    }
    props.onRespond(props.question.questionId, payload);
  };

  return (
    <section class="question-queue chat-column pb-10" aria-label="Pending questions">
      <form class="scroll-mt-12 mb-12" onSubmit={submit}>
        <DecisionCard
          class="question-card elicitation-card"
          data-testid="question-queue-card"
          title="Questions"
          prompt={props.question.description || 'Peri needs your input to continue.'}
          promptId={bodyId}
          currentIndex={props.currentIndex}
          total={props.total}
          onPrevious={props.onPrevious}
          onNext={props.onNext}
          pagerPreviousLabel="Previous question"
          pagerNextLabel="Next question"
          primaryLabel="Submit answers"
          primaryType="submit"
          primaryDisabled={locked() || submitting() || confirmed()}
          primaryBusy={submitting()}
          aria-busy={submitting()}
          headerActions={<Show when={props.question.expiresAt}><span class="inline-flex items-center gap-4 text-10 text-text-muted"><Clock3 size={12} aria-hidden="true" />Expires soon</span></Show>}
        >
          <Show when={confirmed()}>
            <p class="my-4 text-12 text-text-secondary">Answers sent. Peri will continue when the server confirms.</p>
          </Show>
          <Show when={uncertain()}>
            <p class="my-4">Refresh the server status, or hide this question locally. The original answer cannot be sent again.</p>
            <div class="flex flex-wrap gap-8">
              <Button type="button" size="compact" variant="secondary" onClick={props.onRefreshStatus}>Refresh status</Button>
              <Button type="button" size="compact" variant="secondary" class="pointer-coarse:min-h-44!" onClick={props.onDismissUncertain}>Hide question</Button>
            </div>
          </Show>
          <Show when={!confirmed() && !uncertain()}>
            <Show when={validation()}><p role="alert" class="my-4 text-12 text-danger-solid">{validation()}</p></Show>
            <Show when={locked()}><p class="mb-8 inline-flex items-center gap-6 text-11 text-text-muted"><LockKeyhole size={12} aria-hidden="true" />Waiting for server confirmation</p></Show>
            <div id={bodyId} class="grid gap-12">
              <For each={props.question.questions}>{(item, index) => {
                const idx = index();
                const selectedSingle = () => {
                  const value = answerAt(idx);
                  return typeof value === 'string' ? value : '';
                };
                const selectedMulti = () => {
                  const value = answerAt(idx);
                  return Array.isArray(value) ? value : [];
                };
                return (
                  <fieldset class="m-0 min-w-0 border-0 p-0" disabled={locked()}>
                    <legend class="mb-6 text-12 font-650 text-text-primary">{item.header || item.question}</legend>
                    <p class="mb-8 text-11 text-text-secondary">{item.question}</p>
                    <Show when={item.multiSelect} fallback={
                      <RadioGroup value={selectedSingle()} onChange={(value) => setSingle(idx, value)} class="grid gap-6">
                        <For each={item.options}>{(option) => (
                          <RadioGroupItem value={option.label} class="rounded-8 border border-border-subtle px-10 py-8">
                            <RadioGroupItemInput />
                            <RadioGroupItemControl />
                            <RadioGroupItemLabel class="text-12">{option.label}</RadioGroupItemLabel>
                            <Show when={option.description}><span class="text-11 text-text-muted">{option.description}</span></Show>
                          </RadioGroupItem>
                        )}</For>
                      </RadioGroup>
                    }>
                      <div class="grid gap-6">
                        <For each={item.options}>{(option) => (
                          <Checkbox
                            checked={selectedMulti().includes(option.label)}
                            onChange={() => toggleMulti(idx, option.label)}
                            class="rounded-8 border border-border-subtle px-10 py-8"
                          >
                            <CheckboxInput />
                            <CheckboxControl />
                            <CheckboxLabel class="text-12">{option.label}</CheckboxLabel>
                            <Show when={option.description}><span class="text-11 text-text-muted">{option.description}</span></Show>
                          </Checkbox>
                        )}</For>
                      </div>
                    </Show>
                  </fieldset>
                );
              }}</For>
            </div>
          </Show>
        </DecisionCard>
      </form>
    </section>
  );
}
