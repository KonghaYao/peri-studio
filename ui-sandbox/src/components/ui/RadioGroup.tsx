import { RadioGroup as KRadioGroup } from '@kobalte/core/radio-group';
import { For } from 'solid-js';
import { cn } from '@/lib/cn';

export function RadioGroup(props: {
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <KRadioGroup value={props.value} onChange={props.onChange} disabled={props.disabled} name={props.name} class="flex flex-col gap-2">
      <For each={props.options}>
        {(option) => (
          <KRadioGroup.Item value={option.value} class="group inline-flex cursor-pointer items-center gap-2">
            <KRadioGroup.ItemInput class="peer" />
            <KRadioGroup.ItemControl
              class={cn(
                'grid size-4 flex-none place-items-center rounded-full border border-border-strong bg-surface-overlay transition-colors duration-(--duration-fast)',
                'group-hover:border-accent-solid peer-focus-visible:shadow-(--shadow-focus-ring)',
                'data-[checked]:border-accent-solid',
              )}
            >
              <KRadioGroup.ItemIndicator class="size-2 rounded-full bg-accent-solid" />
            </KRadioGroup.ItemControl>
            <KRadioGroup.ItemLabel class="text-13 text-content-primary">{option.label}</KRadioGroup.ItemLabel>
          </KRadioGroup.Item>
        )}
      </For>
    </KRadioGroup>
  );
}
