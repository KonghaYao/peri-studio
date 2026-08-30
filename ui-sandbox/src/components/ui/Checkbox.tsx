import { Checkbox as KCheckbox } from '@kobalte/core/checkbox';
import { Check } from 'lucide-solid';
import { cn } from '@/lib/cn';

export function Checkbox(props: { label?: string; checked?: boolean; onChange?: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <KCheckbox
      class="inline-flex cursor-pointer items-center gap-2 disabled:cursor-not-allowed disabled:opacity-45"
      checked={props.checked}
      onChange={props.onChange}
      disabled={props.disabled}
    >
      <KCheckbox.Input class="peer" />
      <KCheckbox.Control
        class={cn(
          'grid size-4 flex-none place-items-center rounded-sm border border-border-strong bg-surface-overlay transition-colors duration-(--duration-fast)',
          'hover:border-accent-solid peer-focus-visible:shadow-(--shadow-focus-ring)',
          'data-[checked]:border-accent-solid data-[checked]:bg-accent-solid data-[checked]:text-content-on-accent',
        )}
      >
        <KCheckbox.Indicator><Check size={12} strokeWidth={3} /></KCheckbox.Indicator>
      </KCheckbox.Control>
      {props.label && <KCheckbox.Label class="text-13 text-content-primary">{props.label}</KCheckbox.Label>}
    </KCheckbox>
  );
}
