import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { ScrollArea, ScrollAreaViewport } from './ScrollArea';

/** 横向滚动的快捷提示容器。 */
export const Suggestion: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <ScrollArea
      data-slot="suggestion"
      class={cn('w-full', local.class)}
      {...rest}
    >
      <ScrollAreaViewport class="ui-scrollbar">
        <div class="flex w-max min-w-full gap-8 pb-4">{local.children}</div>
      </ScrollAreaViewport>
    </ScrollArea>
  );
};

type SuggestionItemProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

/** 单条快捷提示芯片；点击时回传 suggestion 文本。 */
export const SuggestionItem: Component<SuggestionItemProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'suggestion', 'onClick', 'children', 'variant', 'size']);
  const handleClick = () => local.onClick?.(local.suggestion);

  return (
    <Button
      data-slot="suggestion-item"
      type="button"
      variant={local.variant ?? 'secondary'}
      size={local.size ?? 'sm'}
      class={cn('shrink-0 rounded-full', local.class)}
      onClick={handleClick}
      {...rest}
    >
      {local.children ?? local.suggestion}
    </Button>
  );
};
