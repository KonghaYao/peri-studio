import { Show, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { Checkbox, CheckboxControl, CheckboxInput, CheckboxLabel } from './Checkbox';
import {
  RadioGroupItem,
  RadioGroupItemControl,
  RadioGroupItemInput,
  RadioGroupItemLabel,
} from './RadioGroup';

/** A/B/C… 键位标签（0 → A）。 */
export function questionnaireOptionKeyLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

export function questionnaireOptionListClass(className?: string): string {
  return cn('grid gap-2', className);
}

export function questionnaireOptionRowClass(className?: string): string {
  return cn(
    'group flex min-h-36 items-center gap-12 rounded-md border-0 bg-transparent px-8 py-6 cursor-pointer',
    'hover:bg-interaction-hover data-[checked]:bg-accent-soft pointer-coarse:min-h-44',
    className,
  );
}

export function questionnaireOptionLabelClass(className?: string): string {
  return cn('flex min-w-0 flex-1 items-center gap-12 cursor-pointer', className);
}

export function questionnaireOptionRadioControlClass(className?: string): string {
  return cn('size-16!', className);
}

export function questionnaireOptionCheckboxControlClass(className?: string): string {
  return cn('size-16!', className);
}

export type QuestionnaireOptionKeyProps = {
  index: number;
  class?: string;
};

/** 问卷选项左侧 A/B/C 键位徽章。 */
export const QuestionnaireOptionKey: Component<QuestionnaireOptionKeyProps> = (props) => (
  <span
    aria-hidden="true"
    class={cn(
      'inline-flex size-20 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-10 font-semibold text-content-muted',
      'group-data-[checked]:bg-accent-solid group-data-[checked]:text-content-on-accent',
      props.class,
    )}
  >
    {questionnaireOptionKeyLabel(props.index)}
  </span>
);

export type QuestionnaireOptionTextProps = {
  label: string;
  description?: string | null;
  class?: string;
};

/** 问卷选项主文案与副标题。 */
export const QuestionnaireOptionText: Component<QuestionnaireOptionTextProps> = (props) => (
  <span class={cn('flex min-w-0 flex-col', props.class)}>
    <strong class="text-12 font-medium leading-snug text-content-primary">{props.label}</strong>
    <Show when={props.description}>
      <small class="overflow-hidden text-ellipsis whitespace-nowrap text-10 text-content-muted">
        {props.description}
      </small>
    </Show>
  </span>
);

export type QuestionnaireRadioOptionProps = {
  value: string;
  index: number;
  label: string;
  description?: string | null;
  class?: string;
};

/** Kobalte RadioGroupItem 的问卷选项行（键位 + 文案 + 单选控件）。 */
export const QuestionnaireRadioOption: Component<QuestionnaireRadioOptionProps> = (props) => (
  <RadioGroupItem value={props.value} class={questionnaireOptionRowClass(props.class)}>
    <RadioGroupItemInput />
    <RadioGroupItemLabel class={questionnaireOptionLabelClass()}>
      <QuestionnaireOptionKey index={props.index} />
      <QuestionnaireOptionText label={props.label} description={props.description} />
    </RadioGroupItemLabel>
    <RadioGroupItemControl class={questionnaireOptionRadioControlClass()} />
  </RadioGroupItem>
);

export type QuestionnaireCheckboxOptionProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  index: number;
  label: string;
  description?: string | null;
  class?: string;
};

/** Kobalte Checkbox 的问卷选项行（键位 + 文案 + 多选控件）。 */
export const QuestionnaireCheckboxOption: Component<QuestionnaireCheckboxOptionProps> = (props) => (
  <Checkbox
    checked={props.checked}
    disabled={props.disabled}
    onChange={props.onChange}
    class={questionnaireOptionRowClass(props.class)}
  >
    <CheckboxInput />
    <CheckboxLabel class={questionnaireOptionLabelClass()}>
      <QuestionnaireOptionKey index={props.index} />
      <QuestionnaireOptionText label={props.label} description={props.description} />
    </CheckboxLabel>
    <CheckboxControl class={questionnaireOptionCheckboxControlClass()} />
  </Checkbox>
);
