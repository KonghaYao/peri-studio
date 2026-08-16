import { For, Show, createSignal } from 'solid-js';
import type { PendingElicitation } from '../lib/control-view';
import type { ElicitationAnswer } from '../lib/protocol';
import { Button } from '../../ui';

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

export function ElicitationQueue(props: Props) {
  return <For each={props.elicitations}>{(item) =>
    <ElicitationCard
      elicitation={item}
      busy={item.status === 'responding' || !!props.responding[item.elicitationId]}
      readOnly={props.readOnly}
      onRespond={props.onRespond}
    />
  }</For>;
}

function ElicitationCard(props: {
  elicitation: PendingElicitation;
  busy: boolean;
  readOnly: boolean;
  onRespond: Props['onRespond'];
}) {
  const [answers, setAnswers] = createSignal<Record<string, ElicitationAnswer>>({});
  const [validation, setValidation] = createSignal('');

  const update = (id: string, value: ElicitationAnswer) => {
    setAnswers((current) => ({ ...current, [id]: value }));
    setValidation('');
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

  return <form
    class="elicitation-card scroll-mt-12 mb-16 p-18 border border-border-strong rounded-18 bg-surface shadow-recovery"
    data-elicitation-id={props.elicitation.elicitationId}
    aria-labelledby={`elicitation-${props.elicitation.elicitationId}`}
    aria-busy={props.busy ? 'true' : undefined}
    noValidate
    onSubmit={submit}
  >
    <header class="elicitation-card__header flex items-start gap-12">
      <span aria-hidden="true" class="elicitation-card__mark grid flex-none size-30 place-items-center rounded-10 bg-text-primary text-surface font-750">?</span>
      <div>
        <span class="elicitation-card__eyebrow block mb-3 text-text-muted text-10 font-750 tracking-7 uppercase">Peri needs your input</span>
        <h3 class="m-0 text-text-primary text-15 leading-145 -tracking-1" id={`elicitation-${props.elicitation.elicitationId}`}>{props.elicitation.message}</h3>
      </div>
    </header>
    <div class="elicitation-card__fields grid gap-16 mt-18">
      <For each={props.elicitation.fields}>{(field) =>
        <fieldset class="elicitation-field min-w-0 m-0 p-0 border-0">
          <legend class="p-0 text-text-primary text-13 font-650">{field.title}{field.required ? <span aria-label="Required"> *</span> : null}</legend>
          <Show when={field.description}><p class="mt-3 mb-8 text-text-secondary text-12 leading-15">{field.description}</p></Show>
          <Show when={field.kind === 'text'}>
            <textarea
              rows={3}
              maxlength={4096}
              aria-label={field.title}
              required={field.required}
              disabled={props.busy || props.readOnly}
              value={typeof answers()[field.id] === 'string' ? answers()[field.id] as string : ''}
              onInput={(event) => update(field.id, event.currentTarget.value)}
              class="box-border w-full min-h-82 resize-y px-12 py-11 border border-border-strong rounded-12 bg-surface-muted text-text-primary leading-15 outline-none focus-visible:border-text-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
            />
          </Show>
          <Show when={field.kind === 'single_select'}>
            <div class="elicitation-options grid gap-6">
              <For each={field.options}>{(option) => <label class="flex min-h-42 items-start gap-10 px-11 py-9 border border-divider rounded-11 bg-surface-muted cursor-pointer">
                <input
                  type="radio"
                  name={`${props.elicitation.elicitationId}-${field.id}`}
                  value={option.value}
                  required={field.required}
                  disabled={props.busy || props.readOnly}
                  checked={answers()[field.id] === option.value}
                  onChange={() => update(field.id, option.value)}
                  class="mt-3 accent-text-primary"
                />
                <span class="grid gap-2"><strong class="text-13 font-semibold">{option.label}</strong><Show when={option.description}><small class="text-text-secondary text-11 leading-14">{option.description}</small></Show></span>
              </label>}</For>
            </div>
          </Show>
          <Show when={field.kind === 'multi_select'}>
            <div class="elicitation-options grid gap-6">
              <For each={field.options}>{(option) => {
                const selected = () => Array.isArray(answers()[field.id])
                  ? answers()[field.id] as string[]
                  : [];
                return <label class="flex min-h-42 items-start gap-10 px-11 py-9 border border-divider rounded-11 bg-surface-muted cursor-pointer">
                  <input
                    type="checkbox"
                    value={option.value}
                    disabled={props.busy || props.readOnly}
                    checked={selected().includes(option.value)}
                    onChange={(event) => update(field.id, event.currentTarget.checked
                      ? [...selected(), option.value]
                      : selected().filter((value) => value !== option.value))}
                    class="mt-3 accent-text-primary"
                  />
                  <span class="grid gap-2"><strong class="text-13 font-semibold">{option.label}</strong><Show when={option.description}><small class="text-text-secondary text-11 leading-14">{option.description}</small></Show></span>
                </label>;
              }}</For>
            </div>
          </Show>
        </fieldset>
      }</For>
    </div>
    <Show when={validation()}><p class="elicitation-card__error mt-12 text-12 leading-15 text-danger" role="alert">{validation()}</p></Show>
    <Show when={props.busy}><p class="elicitation-card__status mt-12 text-12 leading-15 text-text-secondary" role="status">Safely handing your answer to Peri…</p></Show>
    <Show when={props.readOnly}><p class="elicitation-card__status mt-12 text-12 leading-15 text-text-secondary">Read-only mode lets you view questions but not submit answers.</p></Show>
    <div class="elicitation-card__actions flex flex-wrap gap-7 mt-18">
      <Button type="submit" variant="primary" busy={props.busy} disabled={props.busy || props.readOnly}>Submit answer</Button>
      <Button type="button" variant="secondary" disabled={props.busy || props.readOnly} onClick={() => props.onRespond(props.elicitation.elicitationId, 'decline')}>Skip</Button>
      <Button type="button" variant="ghost" disabled={props.busy || props.readOnly} onClick={() => props.onRespond(props.elicitation.elicitationId, 'cancel')}>Cancel request</Button>
    </div>
  </form>;
}
