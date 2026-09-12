import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { ScrollArea, ScrollAreaViewport } from './ScrollArea';

/** 横向滚动的快捷提示容器（对齐 AI Elements `Suggestions`）。 */
export const Suggestion: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <ScrollArea
      data-slot="suggestion"
      class={cn('w-full overflow-x-auto whitespace-nowrap', local.class)}
      {...rest}
    >
      <ScrollAreaViewport class="overflow-x-auto whitespace-nowrap ui-scrollbar">
        <div class="flex w-max flex-nowrap items-center gap-8 pb-4">{local.children}</div>
      </ScrollAreaViewport>
    </ScrollArea>
  );
};

/** AI Elements `Suggestions` 别名。 */
export const Suggestions = Suggestion;

type SuggestionItemProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

/** 单条快捷提示芯片（对齐 AI Elements `Suggestion`）；点击时回传 suggestion 文本。 */
export const SuggestionItem: Component<SuggestionItemProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'suggestion', 'onClick', 'children', 'variant', 'size']);
  const handleClick = () => local.onClick?.(local.suggestion);

  return (
    <Button
      data-slot="suggestion-item"
      type="button"
      variant={local.variant ?? 'default'}
      size={local.size ?? 'sm'}
      class={cn('shrink-0 cursor-pointer rounded-full px-16', local.class)}
      onClick={handleClick}
      {...rest}
    >
      {local.children ?? local.suggestion}
    </Button>
  );
};
