import { For, Show, createSignal, createUniqueId } from 'solid-js';
import type { PendingElicitation } from '@/entities/chat/control-view';
import { createIdentitySelection } from '@/features/message/identity-selection';
import type { ElicitationDeliveryState } from '@/features/message/elicitation-delivery';
import type { ElicitationAnswer } from '@/shared/protocol/client';
import {
  Button,
  DecisionQueueShell,
  IconButton,
  QuestionnaireCheckboxOption,
  QuestionnaireRadioOption,
  questionnaireOptionListClass,
  RadioGroup,
  Textarea,
} from '@peri/ui';
import { Clock3, LockKeyhole, X } from 'lucide-solid';
import { QuestionnaireFrame } from '@peri/ui';

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

/** ACP elicitation/create 共用单个问题面板，通过页眉导航避免并发请求竞争焦点。 */
export function ElicitationQueue(props: Props) {
  const [drafts, setDrafts] = createSignal<Record<string, Record<string, ElicitationAnswer>>>({});
  const selection = createIdentitySelection(() => props.elicitations, (item) => item.elicitationId);
  return <Show when={selection.current()?.elicitationId} keyed>{(elicitationId) => {
    const item = () => selection.current()!;
    return <AskUserQuestionDialog
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
    />
  }}</Show>;
}

function AskUserQuestionDialog(props: {
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
  const [answers, setAnswers] = createSignal<Record<string, ElicitationAnswer>>(props.initialAnswers);
  const [validation, setValidation] = createSignal('');
  const [expanded, setExpanded] = createSignal(true);
  const bodyId = `elicitation-body-${createUniqueId()}`;
  const submitting = () => props.delivery?.phase === 'pending';
  const confirmed = () => props.delivery?.phase === 'confirmed';
  const uncertain = () => props.delivery?.phase === 'failed'
    || props.delivery?.phase === 'uncertain'
    || props.delivery?.phase === 'delivery_unknown';
  const locked = () => !!props.delivery || props.elicitation.status === 'responding' || props.readOnly;
  const update = (id: string, value: ElicitationAnswer) => {
    setAnswers((current) => {
      const next = { ...current, [id]: value };
      props.onDraft(next);
      return next;
    });
    setValidation('');
  };
  const cancel = () => {
    if (!locked()) props.onRespond(props.elicitation.elicitationId, 'cancel');
  };
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    for (const field of props.elicitation.fields) {
      const answer = answers()[field.id];
      const empty = answer === undefined || answer === '' || Array.isArray(answer) && answer.length === 0;
      if (field.required && empty) {
        setValidation(`Please answer "${field.title}" first`);
        return;
      }
    }
    props.onRespond(props.elicitation.elicitationId, 'accept', answers());
  };

  return <DecisionQueueShell
    class="chat-column pb-10"
    aria-label="Agent question"
  >
    <form
      class="scroll-mt-12"
      data-elicitation-id={props.elicitation.elicitationId}
      noValidate
      onSubmit={submit}
    >
      <QuestionnaireFrame
        data-testid="elicitation-card"
        class="elicitation-card"
        title="Questions"
        prompt={props.elicitation.message}
        currentIndex={props.currentIndex}
        total={props.total}
        onPrevious={props.onPrevious}
        onNext={props.onNext}
        pagerPreviousLabel="Previous question"
        pagerNextLabel="Next question"
        collapseExpandedLabel="Collapse questions"
        collapseCollapsedLabel="Expand questions"
        expanded={expanded()}
        onExpandedChange={setExpanded}
        skipLabel="Skip"
        onSkip={() => props.onRespond(props.elicitation.elicitationId, 'decline')}
        primaryLabel="Next"
        primaryType="submit"
        primaryDisabled={locked()}
        primaryBusy={submitting()}
        skipDisabled={locked()}
        aria-busy={submitting() ? 'true' : undefined}
        headerActions={(
          <IconButton
            type="button"
            label="Cancel question"
            variant="ghost"
            size="compact"
            disabled={locked()}
            onClick={cancel}
            class="border-0 bg-transparent text-text-muted hover:text-danger"
          >
            <X size={13} strokeWidth={1.8} />
          </IconButton>
        )}
      >
        <div id={bodyId} class="ui-scrollbar elicitation-card__body mt-6 max-h-300 overflow-y-auto max-narrow:px-0">
          <div class="grid">
            <For each={props.elicitation.fields.map((field) => field.id)}>{(fieldId) => {
              const field = () => props.elicitation.fields.find((candidate) => candidate.id === fieldId)!;
              return (
              <fieldset class="elicitation-field min-w-0 m-0 py-10 border-0 border-t border-divider first:border-t-0 first:pt-0 last:pb-0">
                <legend class="p-0 text-text-secondary text-11 font-600">{field().title}{field().required ? <span class="text-text-muted" aria-label="Required"> *</span> : null}</legend>
                <Show when={field().description}><p class="mt-3 mb-7 text-text-muted text-11 leading-15">{field().description}</p></Show>
                <Show when={field().kind === 'text'}>
                  <Textarea variant="bare" class="mt-7 min-h-58! w-full resize-y rounded-10 border border-divider bg-surface-muted px-10 py-8 text-12 leading-18 text-text-primary outline-none focus-visible:border-border-strong focus-visible:outline-none" rows={2} maxlength={4096} aria-label={field().title} required={field().required} disabled={locked()} value={typeof answers()[fieldId] === 'string' ? answers()[fieldId] as string : ''} onInput={(event) => update(fieldId, event.currentTarget.value)} />
                </Show>
                <Show when={field().kind === 'single_select'}>
                  <RadioGroup aria-label={field().title} value={typeof answers()[fieldId] === 'string' ? answers()[fieldId] as string : ''} required={field().required} disabled={locked()} onChange={(value) => update(fieldId, value)} class={questionnaireOptionListClass('mt-12')}>
                    <For each={field().options.map((option) => option.value)}>{(optionValue, index) => {
                      const option = () => field().options.find((candidate) => candidate.value === optionValue)!;
                      return (
                        <QuestionnaireRadioOption
                          value={optionValue}
                          index={index()}
                          label={option().label}
                          description={option().description}
                        />
                      );
                    }}</For>
                  </RadioGroup>
                </Show>
                <Show when={field().kind === 'multi_select'}>
                  <div class={questionnaireOptionListClass('mt-12')}>
                    <For each={field().options.map((option) => option.value)}>{(optionValue, index) => {
                      const option = () => field().options.find((candidate) => candidate.value === optionValue)!;
                      const selected = () => Array.isArray(answers()[fieldId]) ? answers()[fieldId] as string[] : [];
                      return (
                        <QuestionnaireCheckboxOption
                          checked={selected().includes(optionValue)}
                          disabled={locked()}
                          index={index()}
                          label={option().label}
                          description={option().description}
                          onChange={(checked) => update(
                            fieldId,
                            checked ? [...selected(), optionValue] : selected().filter((value) => value !== optionValue),
                          )}
                        />
                      );
                    }}</For>
                  </div>
                </Show>
              </fieldset>
              );
            }}</For>
          </div>
          <Show when={validation()}><p class="mt-9 text-11 leading-15 text-danger" role="alert">{validation()}</p></Show>
          <Show when={submitting()}><span class="mt-8 inline-grid size-22 place-items-center rounded-full border border-border-subtle text-text-muted" role="status" title="Submitting answer"><Clock3 size={12} strokeWidth={1.8} aria-hidden="true" /><span class="sr-only">Submitting answer</span></span></Show>
          <Show when={confirmed()}><span class="mt-8 inline-grid size-22 place-items-center rounded-full border border-border-subtle text-success" role="status" title="Answer received"><Clock3 size={12} strokeWidth={1.8} aria-hidden="true" /><span class="sr-only">Answer received. Waiting for server status.</span></span></Show>
          <Show when={uncertain()}><div class="mt-10 rounded-10 border border-warning-border bg-surface-muted p-10 text-11 leading-15 text-text-secondary" role="alert">
            <strong class="block text-warning">{props.delivery?.phase === 'failed' ? 'Answer was not accepted' : 'Answer delivery not confirmed'}</strong>
            <p class="my-4">Refresh the server status, or hide this question locally. The original answer cannot be sent again.</p>
            <div class="flex flex-wrap gap-5 pt-3">
              <Button type="button" size="compact" variant="primary" class="pointer-coarse:min-h-44!" onClick={props.onRefreshStatus}>Refresh status</Button>
              <Button type="button" size="compact" variant="secondary" class="pointer-coarse:min-h-44!" onClick={props.onDismissUncertain}>Hide question</Button>
            </div>
          </div></Show>
          <Show when={props.readOnly}><span class="mt-8 inline-grid size-22 place-items-center rounded-full border border-border-subtle text-text-muted" role="status" title="Read only"><LockKeyhole size={12} strokeWidth={1.8} aria-hidden="true" /><span class="sr-only">Read only</span></span></Show>
        </div>
      </QuestionnaireFrame>
    </form>
  </DecisionQueueShell>;
}
