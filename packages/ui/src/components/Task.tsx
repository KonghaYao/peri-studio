import { ChevronDown, Search } from 'lucide-solid';
import { Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';

/** 可折叠任务块根容器（AI Elements task）。 */
export const Task: Component<ComponentProps<typeof Collapsible>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'defaultOpen']);
  return (
    <Collapsible
      data-slot="task"
      defaultOpen={local.defaultOpen ?? true}
      class={cn('w-full', local.class)}
      {...rest}
    >
      {local.children}
    </Collapsible>
  );
};

type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
};

/** 任务折叠触发器：搜索图标 + 标题 + 展开箭头。 */
export const TaskTrigger: Component<TaskTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'title', 'children']);
  return (
    <CollapsibleTrigger
      data-slot="task-trigger"
      class={cn(
        'ui-task-trigger group flex w-full cursor-pointer items-center gap-8 border-0 bg-transparent p-0 text-left text-13 text-content-muted transition-colors duration-120 outline-none hover:text-content-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      <Show
        when={local.children}
        fallback={
          <>
            <Search size={14} strokeWidth={1.7} class="shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1">{local.title}</span>
            <ChevronDown
              size={14}
              strokeWidth={1.7}
              class="ui-task-chevron shrink-0 transition-transform duration-120"
              aria-hidden="true"
            />
          </>
        }
      >
        {local.children as JSX.Element}
      </Show>
    </CollapsibleTrigger>
  );
};

/** 任务内容区：左侧竖线 + 子项列表。 */
export const TaskContent: Component<ComponentProps<typeof CollapsibleContent>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <CollapsibleContent
      data-slot="task-content"
      class={cn('overflow-hidden text-13 text-content-primary transition-all duration-120 ease-in-out', local.class)}
      {...rest}
    >
      <div class="mt-16 space-y-8 border-l-2 border-border-subtle pl-16">{local.children}</div>
    </CollapsibleContent>
  );
};

/** 单条任务描述文本。 */
export const TaskItem: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="task-item"
      class={cn('text-13 text-content-secondary', local.class)}
      {...rest}
    />
  );
};

/** 任务内联文件 chip。 */
export const TaskItemFile: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="task-item-file"
      class={cn(
        'inline-flex items-center gap-4 rounded-6 border border-border-subtle bg-surface-overlay px-6 py-2 text-12 text-content-primary',
        local.class,
      )}
      {...rest}
    />
  );
};
