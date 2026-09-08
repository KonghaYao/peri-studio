import { Show } from 'solid-js';
import type { SessionConfigOptionInfo } from '@/entities/chat/control-view';
import { Select } from '@/shared/ui/Select';
import { composerModelLabel } from '@/features/composer/composer-model-label';
import { readOnly } from '../../panel/lib/auth-state';
import { connState } from '@/features/connection/connection';
import { chatHead, sessionConfigMutation, setSessionConfig, turnActive } from '../../panel/store';

export function SessionModelMenu(props: {
  open?: boolean;
  id?: string;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
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
    props.onOpenChange?.(false);
  };

  return (
    <Show
      when={option()}
      fallback={
        <span
          data-testid="composer-runtime"
          class="inline-flex h-28 max-w-full min-w-0 items-center px-4 text-12 text-text-muted"
          title={composerModelLabel(chatHead()?.agent ?? null, sessionConfigMutation())}
        >
          {composerModelLabel(chatHead()?.agent ?? null, sessionConfigMutation())}
        </span>
      }
    >
      {(model) => (
        <Select
          variant="plain"
          open={props.open}
          onOpenChange={props.onOpenChange}
          data-testid="composer-runtime"
          aria-label="Choose model"
          listClass="w-(--container-model-menu)"
          options={model().options.map((choice) => ({
            value: choice.value,
            label: choice.name,
            description: choice.description,
          }))}
          value={displayedValue()}
          onChange={choose}
          disabled={locked() || props.disabled}
        />
      )}
    </Show>
  );
}
