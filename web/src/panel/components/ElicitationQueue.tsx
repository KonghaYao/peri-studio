import { For, Show, createSignal, createUniqueId } from 'solid-js';
import type { PendingElicitation } from '../lib/control-view';
import { createIdentitySelection } from '../lib/identity-selection';
import type { ElicitationDeliveryState } from '../lib/elicitation-delivery';
import type { ElicitationAnswer } from '../lib/protocol';
import { Button, Checkbox, CheckboxControl, CheckboxInput, CheckboxLabel, IconButton, RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemInput, RadioGroupItemLabel, Textarea } from '../../components/ui';
import { ChevronDown, ChevronLeft, ChevronRight, Clock3, LockKeyhole, X } from 'lucide-solid';

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

  return <section
    class="elicitation-inline box-border w-full max-w-(--container-chat) mx-auto px-20 pb-10 desk:max-wide:max-w-(--container-chat-narrow) desk:max-wide:px-18 max-desk:max-w-(--container-chat-narrow) max-narrow:px-10"
    aria-label="Agent question"
  >
    <form
      class="elicitation-card scroll-mt-12 mb-12 overflow-hidden rounded-(--decision-radius) border border-border-subtle bg-surface shadow-float"
      data-elicitation-id={props.elicitation.elicitationId}
      aria-busy={submitting() ? 'true' : undefined}
      noValidate
      onSubmit={submit}
    >
      <header class="elicitation-card__header flex min-h-38 items-center gap-6 px-12 border-b border-divider">
        <span class="text-text-secondary text-11 font-650">Questions</span>
        <Show when={props.total > 1}>
          <span class="flex items-center gap-1">
            <IconButton type="button" label="Previous question" variant="ghost" size="compact" disabled={props.currentIndex === 0} onClick={props.onPrevious} class="size-24 min-h-24 border-0 bg-transparent text-text-muted hover:text-text-primary disabled:opacity-30">
              <ChevronLeft size={13} strokeWidth={1.8} />
            </IconButton>
            <span class="min-w-26 text-center text-text-muted text-9 tabular-nums">{props.currentIndex + 1} / {props.total}</span>
            <IconButton type="button" label="Next question" variant="ghost" size="compact" disabled={props.currentIndex === props.total - 1} onClick={props.onNext} class="size-24 min-h-24 border-0 bg-transparent text-text-muted hover:text-text-primary disabled:opacity-30">
              <ChevronRight size={13} strokeWidth={1.8} />
            </IconButton>
          </span>
        </Show>
        <span class="ml-auto flex items-center gap-1">
          <IconButton type="button" label="Cancel question" variant="ghost" size="compact" disabled={locked()} onClick={cancel} class="size-24 min-h-24 border-0 bg-transparent text-text-muted hover:text-danger">
            <X size={13} strokeWidth={1.8} />
          </IconButton>
          <IconButton type="button" label={expanded() ? 'Collapse questions' : 'Expand questions'} variant="ghost" size="compact" aria-expanded={expanded()} aria-controls={bodyId} onClick={() => setExpanded((value) => !value)} class="size-24 min-h-24 border-0 bg-transparent text-text-muted hover:text-text-primary">
            <ChevronDown size={14} strokeWidth={1.8} class={`transition-transform ${expanded() ? '' : 'rotate-180'}`} />
          </IconButton>
        </span>
      </header>
      <Show when={expanded()}>
      <div id={bodyId} class="ui-scrollbar elicitation-card__body max-h-300 overflow-y-auto px-12 pt-10 pb-4 max-narrow:px-10">
        <p class="mt-0 mb-8 text-text-primary text-12 font-550 leading-18">{props.elicitation.message}</p>
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
                <RadioGroup aria-label={field().title} value={typeof answers()[fieldId] === 'string' ? answers()[fieldId] as string : ''} required={field().required} disabled={locked()} onChange={(value) => update(fieldId, value)} class="elicitation-options grid gap-2 mt-6">
                  <For each={field().options.map((option) => option.value)}>{(optionValue, index) => {
                    const option = () => field().options.find((candidate) => candidate.value === optionValue)!;
                    return <RadioGroupItem value={optionValue} class="elicitation-option group flex min-h-34 items-center gap-7 px-6 py-4 border-0 rounded-7 bg-transparent cursor-pointer hover:bg-hover data-[checked]:bg-selected pointer-coarse:min-h-44">
                    <RadioGroupItemInput />
                    <RadioGroupItemLabel class="flex min-w-0 flex-1 items-center gap-8 cursor-pointer"><span aria-hidden="true" class="elicitation-option__key inline-flex size-18 shrink-0 items-center justify-center rounded-5 bg-surface-muted text-text-muted text-9 font-650 group-data-[checked]:bg-success group-data-[checked]:text-surface">{String.fromCharCode(65 + index())}</span><span class="flex min-w-0 flex-col"><strong class="text-10 leading-15 font-620 text-text-primary">{option().label}</strong><Show when={option().description}><small class="overflow-hidden text-ellipsis whitespace-nowrap text-9 leading-13 text-text-muted">{option().description}</small></Show></span></RadioGroupItemLabel>
                    <RadioGroupItemControl class="ui-radio-control size-14!" />
                  </RadioGroupItem>;
                  }}</For>
                </RadioGroup>
              </Show>
              <Show when={field().kind === 'multi_select'}>
                <div class="elicitation-options grid gap-2 mt-6">
                  <For each={field().options.map((option) => option.value)}>{(optionValue, index) => {
                    const option = () => field().options.find((candidate) => candidate.value === optionValue)!;
                    const selected = () => Array.isArray(answers()[fieldId]) ? answers()[fieldId] as string[] : [];
                    return <Checkbox checked={selected().includes(optionValue)} disabled={locked()} onChange={(checked) => update(fieldId, checked ? [...selected(), optionValue] : selected().filter((value) => value !== optionValue))} class="elicitation-option group flex min-h-34 items-center gap-7 px-6 py-4 border-0 rounded-7 bg-transparent cursor-pointer hover:bg-hover data-[checked]:bg-selected pointer-coarse:min-h-44">
                      <CheckboxInput />
                      <CheckboxLabel class="flex min-w-0 flex-1 items-center gap-8 cursor-pointer"><span aria-hidden="true" class="elicitation-option__key inline-flex size-18 shrink-0 items-center justify-center rounded-5 bg-surface-muted text-text-muted text-9 font-650 group-data-[checked]:bg-success group-data-[checked]:text-surface">{String.fromCharCode(65 + index())}</span><span class="flex min-w-0 flex-col"><strong class="text-10 leading-15 font-620 text-text-primary">{option().label}</strong><Show when={option().description}><small class="overflow-hidden text-ellipsis whitespace-nowrap text-9 leading-13 text-text-muted">{option().description}</small></Show></span></CheckboxLabel>
                      <CheckboxControl class="ui-checkbox-control size-14!" />
                    </Checkbox>;
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
      <div class="flex min-h-38 items-center justify-end gap-4 border-t border-divider px-12 py-5 max-narrow:px-10">
        <Button class="px-9!" type="button" variant="ghost" disabled={locked()} onClick={() => props.onRespond(props.elicitation.elicitationId, 'decline')}>Skip</Button>
        <Button class="px-11! rounded-8 border-success bg-success text-surface hover:bg-success" type="submit" variant="primary" busy={submitting()} disabled={locked()}>Continue</Button>
      </div>
      </Show>
    </form>
  </section>;
}
