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
      class={cn('mb-8 w-full text-12 text-content-primary', local.class)}
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
        'ui-sources-trigger flex w-fit cursor-pointer items-center gap-8 border-0 bg-transparent py-4 text-left text-12 outline-none transition-colors duration-120 hover:text-content-secondary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      {local.children ?? (
        <>
          <span class="font-medium">Used {local.count} sources</span>
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
      class={cn(
        'mt-12 flex w-fit flex-col gap-8 overflow-hidden text-12 transition-all duration-120 ease-in-out',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </CollapsibleContent>
  );
};

type SourceItemProps = ComponentProps<'a'> & {
  title?: string;
};

/** 单条来源链接（AI Elements `Source` 别名见 `Source`）。 */
export const SourceItem: Component<SourceItemProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'href', 'title', 'children']);
  return (
    <a
      data-slot="source-item"
      href={local.href}
      target="_blank"
      rel="noreferrer"
      class={cn(
        'flex items-center gap-8 text-12 text-content-secondary transition-colors duration-120 hover:text-content-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      {local.children ?? (
        <>
          <Book size={14} strokeWidth={1.7} class="shrink-0 text-content-muted" aria-hidden="true" />
          <span class="block min-w-0 truncate font-medium">{local.title ?? local.href}</span>
        </>
      )}
    </a>
  );
};

/** AI Elements `Source` 别名。 */
export const Source = SourceItem;
