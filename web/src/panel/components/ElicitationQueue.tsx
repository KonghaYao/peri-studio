import { For, Show, createSignal } from 'solid-js';
import type { PendingElicitation } from '../lib/control-view';
import type { ElicitationAnswer } from '../lib/protocol';
import { Button, Checkbox, CheckboxControl, CheckboxInput, CheckboxLabel, RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemInput, RadioGroupItemLabel, Textarea } from '../../components/ui';

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

/** ACP elicitation/create 以串行 modal 呈现，避免并发请求竞争焦点。 */
export function ElicitationQueue(props: Props) {
  const current = () => props.elicitations[0];
  return <Show when={current()} keyed>{(item) =>
    <AskUserQuestionDialog
      elicitation={item}
      busy={item.status === 'responding' || !!props.responding[item.elicitationId]}
      readOnly={props.readOnly}
      onRespond={props.onRespond}
    />
  }</Show>;
}

function AskUserQuestionDialog(props: {
  elicitation: PendingElicitation;
  busy: boolean;
  readOnly: boolean;
  onRespond: Props['onRespond'];
}) {
  const [answers, setAnswers] = createSignal<Record<string, ElicitationAnswer>>({});
  const [validation, setValidation] = createSignal('');
  const locked = () => props.busy || props.readOnly;
  const update = (id: string, value: ElicitationAnswer) => {
    setAnswers((current) => ({ ...current, [id]: value }));
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
    class="elicitation-inline box-border w-full max-w-(--container-chat) mx-auto px-16 pb-10"
    aria-label="Agent question"
  >
    <form
      class="elicitation-card scroll-mt-12 mb-16 max-h-300 overflow-y-auto p-18 rounded-18 border border-border-strong bg-surface shadow-recovery max-[640px]:p-15"
      data-elicitation-id={props.elicitation.elicitationId}
      aria-busy={props.busy ? 'true' : undefined}
      noValidate
      onSubmit={submit}
    >
      <div class="px-18 pt-16 pb-4">
        <span class="block mb-4 text-text-muted text-10 font-750 tracking-7 uppercase">Peri needs your input</span>
        <p class="mt-0 mb-18 text-text-secondary text-13 leading-155">{props.elicitation.message}</p>
        <div class="grid gap-18">
          <For each={props.elicitation.fields}>{(field) =>
            <fieldset class="elicitation-field min-w-0 m-0 p-0 border-0">
              <legend class="p-0 text-text-primary text-13 font-650">{field.title}{field.required ? <span aria-label="Required"> *</span> : null}</legend>
              <Show when={field.description}><p class="mt-3 mb-8 text-text-secondary text-12 leading-15">{field.description}</p></Show>
              <Show when={field.kind === 'text'}>
                <Textarea variant="field" rows={3} maxlength={4096} aria-label={field.title} required={field.required} disabled={locked()} value={typeof answers()[field.id] === 'string' ? answers()[field.id] as string : ''} onInput={(event) => update(field.id, event.currentTarget.value)} />
              </Show>
              <Show when={field.kind === 'single_select'}>
                <RadioGroup aria-label={field.title} value={typeof answers()[field.id] === 'string' ? answers()[field.id] as string : ''} required={field.required} disabled={locked()} onChange={(value) => update(field.id, value)} class="elicitation-options grid gap-6 mt-8">
                  <For each={field.options}>{(option) => <RadioGroupItem value={option.value} class="elicitation-option flex min-h-42 items-start gap-10 px-11 py-9 border border-divider rounded-11 bg-surface-muted cursor-pointer data-[checked]:border-text-primary data-[checked]:bg-selected">
                    <RadioGroupItemInput />
                    <RadioGroupItemControl class="ui-radio-control mt-3" />
                    <RadioGroupItemLabel class="grid gap-2"><strong class="text-13 font-semibold">{option.label}</strong><Show when={option.description}><small class="text-text-secondary text-11 leading-14">{option.description}</small></Show></RadioGroupItemLabel>
                  </RadioGroupItem>}</For>
                </RadioGroup>
              </Show>
              <Show when={field.kind === 'multi_select'}>
                <div class="elicitation-options grid gap-6 mt-8">
                  <For each={field.options}>{(option) => {
                    const selected = () => Array.isArray(answers()[field.id]) ? answers()[field.id] as string[] : [];
                    return <Checkbox checked={selected().includes(option.value)} disabled={locked()} onChange={(checked) => update(field.id, checked ? [...selected(), option.value] : selected().filter((value) => value !== option.value))} class="elicitation-option flex min-h-42 items-start gap-10 px-11 py-9 border border-divider rounded-11 bg-surface-muted cursor-pointer data-[checked]:border-text-primary data-[checked]:bg-selected">
                      <CheckboxInput />
                      <CheckboxControl class="ui-checkbox-control mt-3" />
                      <CheckboxLabel class="grid gap-2"><strong class="text-13 font-semibold">{option.label}</strong><Show when={option.description}><small class="text-text-secondary text-11 leading-14">{option.description}</small></Show></CheckboxLabel>
                    </Checkbox>;
                  }}</For>
                </div>
              </Show>
            </fieldset>
          }</For>
        </div>
        <Show when={validation()}><p class="mt-12 text-12 leading-15 text-danger" role="alert">{validation()}</p></Show>
        <Show when={props.busy}><p class="mt-12 text-12 leading-15 text-text-secondary" role="status">Safely handing your answer to Peri…</p></Show>
        <Show when={props.readOnly}><p class="mt-12 text-12 leading-15 text-text-secondary">Read-only mode lets you view questions but not submit answers.</p></Show>
      </div>
      <div class="flex flex-wrap justify-end gap-7 mt-16 px-18 py-14 border-t border-divider">
        <Button class="max-[640px]:basis-full max-[640px]:min-h-44" type="button" variant="ghost" disabled={locked()} onClick={() => props.onRespond(props.elicitation.elicitationId, 'decline')}>Decline</Button>
        <Button class="max-[640px]:flex-1 max-[640px]:min-h-44" type="button" variant="secondary" disabled={locked()} onClick={cancel}>Cancel</Button>
        <Button class="max-[640px]:flex-1 max-[640px]:min-h-44" type="submit" variant="primary" busy={props.busy} disabled={locked()}>Submit answer</Button>
      </div>
    </form>
  </section>;
}
