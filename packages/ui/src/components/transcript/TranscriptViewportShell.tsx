import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  MessageScroller,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '../MessageScroller';

export type TranscriptViewportShellProps = {
  class?: string;
  viewportClass?: string;
  'aria-label'?: string;
  footerSpacerHeight?: number;
  children?: JSX.Element;
  /** 置于 viewport 之后、仍留在 MessageScroller 相对定位上下文内（如 jump-latest）。 */
  trailing?: JSX.Element;
  viewportRef?: (element: HTMLDivElement | undefined) => void;
  onScroll?: JSX.EventHandlerUnion<HTMLDivElement, Event>;
  'data-testid'?: string;
  viewportTestId?: string;
};

/** T3 · Transcript 滚动视口壳：MessageScroller 外框 + 标准 transcript 类名。 */
export const TranscriptViewportShell: Component<TranscriptViewportShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'viewportClass',
    'footerSpacerHeight',
    'children',
    'trailing',
    'viewportRef',
    'onScroll',
    'viewportTestId',
  ]);

  return (
    <MessageScrollerProvider autoScroll={false}>
      <MessageScroller
        data-slot="transcript-viewport-shell"
        class={cn('ui-transcript-viewport-shell min-h-0 min-w-0 flex-1', local.class)}
      >
        <MessageScrollerViewport
          {...rest}
          ref={local.viewportRef}
          onScroll={local.onScroll}
          data-testid={local.viewportTestId ?? rest['data-testid'] ?? 'message-list-scroll'}
          class={cn('ui-transcript-scroll min-h-0 min-w-0 flex-1 overflow-x-hidden', local.viewportClass)}
        >
          {local.children}
          <Show when={(local.footerSpacerHeight ?? 0) > 0}>
            <div
              class="ui-transcript-footer-spacer"
              aria-hidden="true"
              style={{ height: `${local.footerSpacerHeight}px` }}
            />
          </Show>
        </MessageScrollerViewport>
        {local.trailing}
      </MessageScroller>
    </MessageScrollerProvider>
  );
};
