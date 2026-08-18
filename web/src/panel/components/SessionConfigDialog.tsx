import { For, Show } from 'solid-js';
import type { SessionConfigOptionInfo } from '../lib/control-view';
import { readOnly } from '../lib/auth-state';
import { connState } from '../lib/connection';
import {
  chatHead,
  sessionConfigMutation,
  setSessionConfig,
  turnActive,
} from '../store';
import { Menu, MenuItem } from '../../ui';

export function SessionModelMenu(props: {
  open: boolean;
  id: string;
  trigger: () => HTMLElement | undefined;
  onClose: () => void;
}) {
  const option = (): SessionConfigOptionInfo | null =>
    chatHead()?.agent?.configOptions?.find((item) => item.category === 'model') ?? null;
  const locked = () => readOnly() || turnActive() || connState().kind !== 'ok' || !!sessionConfigMutation();
  const displayedValue = () => {
    const model = option();
    const mutation = sessionConfigMutation();
    return model && mutation?.configId === model.id ? mutation.previousValue : model?.currentValue;
  };
  const choose = (value: string) => {
    const model = option();
    if (!model || value === displayedValue() || locked()) return;
    setSessionConfig(model.id, value);
    props.onClose();
  };

  return <Menu
    open={props.open}
    id={props.id}
    label="Choose model"
    trigger={props.trigger}
    onClose={props.onClose}
  >
    <Show when={option()} fallback={<p class="model-menu__empty px-12 py-10 text-text-muted text-12">No model choices available</p>}>
      {(model) => <>
        <div class="model-menu__heading px-12 pt-10 pb-6 text-text-muted text-10 font-semibold uppercase tracking-8">Model</div>
        <For each={model().options}>{(choice) => {
          const selected = () => choice.value === displayedValue();
          return <MenuItem
            class="model-menu__item grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-14 gap-y-2"
            aria-current={selected() ? 'true' : undefined}
            disabled={locked()}
            onClick={() => choose(choice.value)}
          >
            <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{choice.name}</span>
            <Show when={selected()}><span class="text-accent" aria-label="Current model">✓</span></Show>
            <Show when={choice.description}><small class="col-span-full text-text-muted text-10p5 leading-145">{choice.description}</small></Show>
          </MenuItem>;
        }}</For>
      </>}
    </Show>
  </Menu>;
}
