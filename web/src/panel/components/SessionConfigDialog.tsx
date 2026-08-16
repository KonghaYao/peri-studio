import { createEffect, createSignal, For, Show } from 'solid-js';
import { readOnly } from '../lib/auth-state';
import type { SessionConfigChoiceInfo, SessionConfigOptionInfo } from '../lib/control-view';
import {
  chatHead,
  retrySessionConfigMutation,
  sessionConfigMutation,
  setSessionConfig,
  turnActive,
} from '../store';
import { connState } from '../lib/connection';
import { Button, Dialog } from '../../ui';

export function SessionConfigDialog(props: { open: boolean; onClose: () => void }) {
  let confirmationPanel: HTMLElement | undefined;
  let confirmationReturn: HTMLButtonElement | undefined;
  const [confirmation, setConfirmation] = createSignal<{
    option: SessionConfigOptionInfo;
    choice: SessionConfigChoiceInfo;
  } | null>(null);
  const options = () => chatHead()?.agent?.configOptions ?? [];
  const locked = () => readOnly() || turnActive() || connState().kind !== 'ok' || !!sessionConfigMutation();
  const displayedValue = (option: SessionConfigOptionInfo) => {
    const mutation = sessionConfigMutation();
    return mutation?.configId === option.id ? mutation.previousValue : option.currentValue;
  };
  createEffect(() => {
    if (confirmation()) {
      queueMicrotask(() => confirmationPanel?.querySelector<HTMLButtonElement>('.ui-button--danger')?.focus());
    }
  });
  const close = () => {
    setConfirmation(null);
    props.onClose();
  };

  const choose = (option: SessionConfigOptionInfo, choice: SessionConfigChoiceInfo, trigger: HTMLButtonElement) => {
    if (choice.value === displayedValue(option) || locked()) return;
    if (isPermissionBypass(option, choice)) {
      confirmationReturn = trigger;
      setConfirmation({ option, choice });
      return;
    }
    setSessionConfig(option.id, choice.value);
  };

  return (
    <Dialog open={props.open} title="Agent session config" onClose={close} showHeader>
      <div class="session-config flex max-h-(--container-config) flex-col gap-12 overflow-auto px-18 pb-18">
        <p class="session-config__intro m-0 text-text-secondary text-12 leading-155">These options are provided live by the current Peri agent via ACP and apply only to this session.</p>
        <Show when={turnActive()}>
          <p class="session-config__notice flex items-center justify-between gap-10 m-0 px-11 py-10 rounded-10 bg-surface-muted text-text-secondary text-12 leading-145" role="status">Config cannot be changed while the agent is working. Stop it or wait for the current turn to finish before trying again.</p>
        </Show>
        <Show when={sessionConfigMutation()}>{(mutation) =>
          <div class={`session-config__notice session-config__notice--${mutation().phase} flex items-center justify-between gap-10 m-0 px-11 py-10 rounded-10 bg-surface-muted text-text-secondary text-12 leading-145 ${mutation().phase === 'uncertain' ? 'border border-warning-border bg-warning-soft text-warning' : ''}`} role="status">
            <Show when={mutation().phase === 'uncertain'} fallback={<span>Waiting for the agent to confirm the config…</span>}>
              <span>The server cannot confirm whether this config took effect. Do not start a new request.</span>
              <Button size="compact" onClick={retrySessionConfigMutation}>Re-check with the original request</Button>
            </Show>
          </div>
        }</Show>
        <Show when={options().length > 0} fallback={<p class="session-config__empty m-0 text-text-secondary text-12 leading-155">The current agent does not provide any configurable session options.</p>}>
          <div class="session-config__options flex flex-col gap-14">
            <For each={options()}>{(option) =>
              <fieldset class="session-config__group min-w-0 m-0 p-0 border-0" disabled={locked()}>
                <legend>{option.name}</legend>
                <Show when={option.description}><p>{option.description}</p></Show>
                <div class="session-config__choices grid grid-cols-config gap-6 mt-8">
                  <For each={option.options}>{(choice) =>
                    <button
                      type="button"
                      class={`session-config__choice ${choice.value === displayedValue(option) ? 'is-selected' : ''} flex min-h-50 flex-col justify-center gap-3 px-10 py-9 border border-border-subtle rounded-10 bg-surface text-text-primary cursor-pointer text-left hover:bg-hover`}
                      aria-pressed={choice.value === displayedValue(option)}
                      onClick={(event) => choose(option, choice, event.currentTarget)}
                    >
                      <span>{choice.name}</span>
                      <Show when={choice.description}><small>{choice.description}</small></Show>
                    </button>
                  }</For>
                </div>
              </fieldset>
            }</For>
          </div>
        </Show>
        <Show when={confirmation()}>{(pending) =>
          <section ref={confirmationPanel} class="session-config__confirmation p-12 border border-danger-border rounded-11 bg-danger-soft" role="alert" aria-label="Confirm permission bypass">
            <strong>Switch to “{pending().choice.name}”?</strong>
            <p>This mode may let the agent run tools without asking for each one. Only enable it when you trust the current project and instructions.</p>
            <div>
              <Button variant="secondary" onClick={() => {
                setConfirmation(null);
                queueMicrotask(() => confirmationReturn?.focus());
              }}>Cancel</Button>
              <Button variant="danger" onClick={() => {
                const selection = pending();
                setConfirmation(null);
                setSessionConfig(selection.option.id, selection.choice.value);
              }}>Enable</Button>
            </div>
          </section>
        }</Show>
      </div>
    </Dialog>
  );
}

function isPermissionBypass(option: SessionConfigOptionInfo, choice: SessionConfigChoiceInfo): boolean {
  return option.category === 'mode' && choice.value === 'bypassPermissions';
}
