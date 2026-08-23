import { For, Show, createEffect, createSignal, createUniqueId } from 'solid-js';
import type { PendingElicitation } from '../lib/control-view';
import type { ElicitationAnswer } from '../lib/protocol';
import { Button, Checkbox, CheckboxControl, CheckboxInput, CheckboxLabel, Icon, IconButton, RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemInput, RadioGroupItemLabel, Textarea } from '../../components/ui';

interface Props {
  elicitations: PendingElicitation[];
  responding: Record<string, string>;
  readOnly: boolean;
  onRespond: (
    elicitationId: string,
    action: 'accept' | 'decline' | 'cancel',
    answers?: Record<string, ElicitationAnswer>,
  ) => void;
}

/** ACP elicitation/create 共用单个问题面板，通过页眉导航避免并发请求竞争焦点。 */
export function ElicitationQueue(props: Props) {
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [drafts, setDrafts] = createSignal<Record<string, Record<string, ElicitationAnswer>>>({});
  const current = () => props.elicitations[currentIndex()];
  createEffect(() => {
    const lastIndex = Math.max(0, props.elicitations.length - 1);
    if (currentIndex() > lastIndex) setCurrentIndex(lastIndex);
  });
  return <Show when={current()} keyed>{(item) =>
    <AskUserQuestionDialog
      elicitation={item}
      busy={item.status === 'responding' || !!props.responding[item.elicitationId]}
      readOnly={props.readOnly}
      currentIndex={currentIndex()}
      total={props.elicitations.length}
      initialAnswers={drafts()[item.elicitationId] ?? {}}
      onDraft={(answers) => setDrafts((current) => ({ ...current, [item.elicitationId]: answers }))}
      onPrevious={() => setCurrentIndex((index) => Math.max(0, index - 1))}
      onNext={() => setCurrentIndex((index) => Math.min(props.elicitations.length - 1, index + 1))}
      onRespond={props.onRespond}
    />
  }</Show>;
}

function AskUserQuestionDialog(props: {
  elicitation: PendingElicitation;
  busy: boolean;
  readOnly: boolean;
  currentIndex: number;
  total: number;
  initialAnswers: Record<string, ElicitationAnswer>;
  onDraft: (answers: Record<string, ElicitationAnswer>) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRespond: Props['onRespond'];
}) {
  const [answers, setAnswers] = createSignal<Record<string, ElicitationAnswer>>(props.initialAnswers);
  const [validation, setValidation] = createSignal('');
  const [expanded, setExpanded] = createSignal(true);
  const bodyId = `elicitation-body-${createUniqueId()}`;
  const locked = () => props.busy || props.readOnly;
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
      class="elicitation-card scroll-mt-12 mb-12 overflow-hidden rounded-16 border border-border-strong bg-surface shadow-float"
      data-elicitation-id={props.elicitation.elicitationId}
      aria-busy={props.busy ? 'true' : undefined}
      noValidate
      onSubmit={submit}
    >
      <header class="elicitation-card__header flex min-h-42 items-center gap-7 px-14 border-b border-divider">
        <span class="text-text-secondary text-12 font-600">Questions</span>
        <Show when={props.total > 1}>
          <span class="flex items-center gap-1">
            <IconButton type="button" label="Previous question" variant="ghost" size="compact" disabled={props.currentIndex === 0} onClick={props.onPrevious} class="size-26 min-h-26 border-0 bg-transparent text-text-muted hover:text-text-primary disabled:opacity-30">
              <Icon class="size-14!"><path d="m12.5 5-5 5 5 5" /></Icon>
            </IconButton>
            <span class="min-w-28 text-center text-text-faint text-10 tabular-nums">{props.currentIndex + 1} / {props.total}</span>
            <IconButton type="button" label="Next question" variant="ghost" size="compact" disabled={props.currentIndex === props.total - 1} onClick={props.onNext} class="size-26 min-h-26 border-0 bg-transparent text-text-muted hover:text-text-primary disabled:opacity-30">
              <Icon class="size-14!"><path d="m7.5 5 5 5-5 5" /></Icon>
            </IconButton>
          </span>
        </Show>
        <span class="ml-auto flex items-center gap-1">
          <IconButton type="button" label="Cancel question" variant="ghost" size="compact" disabled={locked()} onClick={cancel} class="size-28 min-h-28 border-0 bg-transparent text-text-muted hover:text-text-primary">
            <Icon class="size-14!"><path d="m5 5 10 10M15 5 5 15" /></Icon>
          </IconButton>
          <IconButton type="button" label={expanded() ? 'Collapse questions' : 'Expand questions'} variant="ghost" size="compact" aria-expanded={expanded()} aria-controls={bodyId} onClick={() => setExpanded((value) => !value)} class="size-28 min-h-28 border-0 bg-transparent text-text-muted hover:text-text-primary">
            <Icon class={`size-15! transition-transform ${expanded() ? '' : 'rotate-180'}`}><path d="m5 8 5 5 5-5" /></Icon>
          </IconButton>
        </span>
      </header>
      <Show when={expanded()}>
      <div id={bodyId} class="ui-scrollbar elicitation-card__body max-h-300 overflow-y-auto px-14 pt-13 pb-5 max-narrow:px-12">
        <p class="mt-0 mb-11 text-text-primary text-14 font-550 leading-155">{props.elicitation.message}</p>
        <div class="grid">
          <For each={props.elicitation.fields}>{(field) =>
            <fieldset class="elicitation-field min-w-0 m-0 py-10 border-0 border-t border-divider first:border-t-0 first:pt-0 last:pb-0">
              <legend class="p-0 text-text-secondary text-11 font-600">{field.title}{field.required ? <span class="text-text-muted" aria-label="Required"> *</span> : null}</legend>
              <Show when={field.description}><p class="mt-3 mb-7 text-text-muted text-11 leading-15">{field.description}</p></Show>
              <Show when={field.kind === 'text'}>
                <Textarea variant="bare" class="mt-7 min-h-58! w-full resize-y rounded-10 border border-divider bg-surface-muted px-10 py-8 text-12 leading-18 text-text-primary outline-none focus-visible:border-border-strong focus-visible:outline-none" rows={2} maxlength={4096} aria-label={field.title} required={field.required} disabled={locked()} value={typeof answers()[field.id] === 'string' ? answers()[field.id] as string : ''} onInput={(event) => update(field.id, event.currentTarget.value)} />
              </Show>
              <Show when={field.kind === 'single_select'}>
                <RadioGroup aria-label={field.title} value={typeof answers()[field.id] === 'string' ? answers()[field.id] as string : ''} required={field.required} disabled={locked()} onChange={(value) => update(field.id, value)} class="elicitation-options grid gap-2 mt-6">
                  <For each={field.options}>{(option, index) => <RadioGroupItem value={option.value} class="elicitation-option group flex min-h-36 items-center gap-9 px-7 py-6 border-0 rounded-8 bg-transparent cursor-pointer hover:bg-hover data-[checked]:bg-selected pointer-coarse:min-h-44">
                    <RadioGroupItemInput />
                    <RadioGroupItemLabel class="flex min-w-0 flex-1 items-baseline gap-8 cursor-pointer"><span aria-hidden="true" class="elicitation-option__key inline-flex size-18 shrink-0 items-center justify-center rounded-5 bg-surface-muted text-text-muted text-10 font-650 group-data-[checked]:bg-text-primary group-data-[checked]:text-surface">{String.fromCharCode(65 + index())}</span><span class="min-w-0 text-12 leading-17"><strong class="font-550 text-text-primary">{option.label}</strong><Show when={option.description}><small class="text-text-muted"> — {option.description}</small></Show></span></RadioGroupItemLabel>
                    <RadioGroupItemControl class="ui-radio-control size-14!" />
                  </RadioGroupItem>}</For>
                </RadioGroup>
              </Show>
              <Show when={field.kind === 'multi_select'}>
                <div class="elicitation-options grid gap-2 mt-6">
                  <For each={field.options}>{(option, index) => {
                    const selected = () => Array.isArray(answers()[field.id]) ? answers()[field.id] as string[] : [];
                    return <Checkbox checked={selected().includes(option.value)} disabled={locked()} onChange={(checked) => update(field.id, checked ? [...selected(), option.value] : selected().filter((value) => value !== option.value))} class="elicitation-option group flex min-h-36 items-center gap-9 px-7 py-6 border-0 rounded-8 bg-transparent cursor-pointer hover:bg-hover data-[checked]:bg-selected pointer-coarse:min-h-44">
                      <CheckboxInput />
                      <CheckboxLabel class="flex min-w-0 flex-1 items-baseline gap-8 cursor-pointer"><span aria-hidden="true" class="elicitation-option__key inline-flex size-18 shrink-0 items-center justify-center rounded-5 bg-surface-muted text-text-muted text-10 font-650 group-data-[checked]:bg-text-primary group-data-[checked]:text-surface">{String.fromCharCode(65 + index())}</span><span class="min-w-0 text-12 leading-17"><strong class="font-550 text-text-primary">{option.label}</strong><Show when={option.description}><small class="text-text-muted"> — {option.description}</small></Show></span></CheckboxLabel>
                      <CheckboxControl class="ui-checkbox-control size-14!" />
                    </Checkbox>;
                  }}</For>
                </div>
              </Show>
            </fieldset>
          }</For>
        </div>
        <Show when={validation()}><p class="mt-9 text-11 leading-15 text-danger" role="alert">{validation()}</p></Show>
        <Show when={props.busy}><p class="mt-9 text-11 leading-15 text-text-muted" role="status">Submitting…</p></Show>
        <Show when={props.readOnly}><p class="mt-9 text-11 leading-15 text-text-muted">Read only</p></Show>
      </div>
      <div class="flex items-center justify-end gap-5 px-14 py-10 max-narrow:px-12">
        <Button class="min-h-32! px-10! text-12 max-narrow:min-h-44!" type="button" variant="ghost" disabled={locked()} onClick={() => props.onRespond(props.elicitation.elicitationId, 'decline')}>Skip</Button>
        <Button class="min-h-32! px-12! rounded-full text-12 max-narrow:min-h-44!" type="submit" variant="primary" busy={props.busy} disabled={locked()}>Continue</Button>
      </div>
      </Show>
    </form>
  </section>;
}
