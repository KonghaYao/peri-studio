import { Book, ChevronDown } from 'lucide-solid';
import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './Collapsible';

/** 消息级引用来源的可折叠根容器。 */
export const Sources: Component<ComponentProps<typeof Collapsible>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <Collapsible
      data-slot="sources"
      class={cn('mb-8 w-full', local.class)}
      {...rest}
    >
      {local.children}
    </Collapsible>
  );
};

type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

/** 展示来源数量并切换折叠状态。 */
export const SourcesTrigger: Component<SourcesTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'count', 'children']);
  return (
    <CollapsibleTrigger
      data-slot="sources-trigger"
      class={cn(
        'ui-sources-trigger flex w-full cursor-pointer items-center gap-8 border-0 bg-transparent py-4 text-left text-12 text-content-muted transition-colors duration-120 outline-none hover:text-content-secondary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      {local.children ?? (
        <>
          <Book size={14} strokeWidth={1.7} class="shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1">Used {local.count} sources</span>
          <ChevronDown
            size={14}
            strokeWidth={1.7}
            class="ui-sources-chevron shrink-0 text-content-muted"
            aria-hidden="true"
          />
        </>
      )}
    </CollapsibleTrigger>
  );
};

export const SourcesContent: Component<ComponentProps<typeof CollapsibleContent>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <CollapsibleContent
      data-slot="sources-content"
      class={cn('flex flex-col gap-8 overflow-hidden text-12 transition-all duration-120 ease-in-out', local.class)}
      {...rest}
    >
      <div class="flex flex-col gap-8 pb-8">{local.children}</div>
    </CollapsibleContent>
  );
};

type SourceItemProps = ComponentProps<'a'> & {
  title?: string;
};

/** 单条来源链接。 */
export const SourceItem: Component<SourceItemProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'href', 'title', 'children']);
  return (
    <a
      data-slot="source-item"
      href={local.href}
      target="_blank"
      rel="noreferrer"
      class={cn(
        'flex items-start gap-8 rounded-6 px-8 py-6 text-12 text-content-secondary transition-colors duration-120 hover:bg-interaction-hover hover:text-content-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      {local.children ?? (
        <>
          <Book size={14} strokeWidth={1.7} class="mt-1 shrink-0 text-content-muted" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{local.title ?? local.href}</span>
        </>
      )}
    </a>
  );
};
