import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { Checkbox, CheckboxControl, CheckboxInput, CheckboxLabel } from './Checkbox';

type TaskRootProps = ComponentProps<'div'>;

export const Task: Component<TaskRootProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="task"
      role="list"
      class={cn('flex w-full flex-col gap-4 rounded-8 border border-border-subtle bg-surface p-8', local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
};

type TaskItemProps = ComponentProps<'div'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
};

export const TaskItem: Component<TaskItemProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'checked',
    'defaultChecked',
    'onCheckedChange',
    'disabled',
  ]);

  return (
    <div
      data-slot="task-item"
      role="listitem"
      class={cn(
        'flex min-w-0 items-start gap-10 rounded-6 px-8 py-6 transition-colors duration-120',
        'hover:bg-interaction-hover',
        local.class,
      )}
      {...rest}
    >
      <Checkbox
        class="mt-2 flex min-w-0 flex-1 items-start gap-10"
        checked={local.checked}
        defaultChecked={local.defaultChecked}
        onChange={local.onCheckedChange}
        disabled={local.disabled}
      >
        <CheckboxInput class="mt-2 shrink-0" />
        <CheckboxControl class="mt-2 shrink-0" />
        <CheckboxLabel class="min-w-0 flex-1 cursor-pointer space-y-2">{local.children}</CheckboxLabel>
      </Checkbox>
    </div>
  );
};

export const TaskItemTitle: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="task-item-title"
      class={cn('text-13 font-medium text-content-primary', local.class)}
      {...rest}
    />
  );
};

export const TaskItemDescription: Component<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <p
      data-slot="task-item-description"
      class={cn('m-0 text-12 text-content-secondary', local.class)}
      {...rest}
    />
  );
};
