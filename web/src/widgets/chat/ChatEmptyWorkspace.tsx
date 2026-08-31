import { splitProps, type JSX } from 'solid-js';
import { cn } from '@/shared/lib/cn';

/** 空会话主标题（输入框上方）。 */
export const CHAT_EMPTY_TITLE = 'What do you want to build?';

type Props = {
  title?: string;
  hint?: string;
  children: JSX.Element;
  class?: string;
};

/** Chat 空会话布局：居中 Composer，底部可选提示。Launch 与已选空 session 共用。 */
export function ChatEmptyWorkspace(props: Props) {
  const [local, div] = splitProps(props, ['title', 'hint', 'children', 'class']);
  return (
    <div
      {...div}
      data-testid="chat-empty-workspace"
      class={cn('chat-empty-workspace flex min-h-0 flex-1 flex-col items-center overflow-x-hidden overflow-y-auto px-24 pb-20 max-narrow:px-10 max-narrow:pb-10', local.class)}
    >
      <div class="flex w-full max-w-(--composer-launch-max) flex-1 flex-col items-center justify-center">
        {local.title && (
          <h2
            data-testid="chat-empty-title"
            class="chat-empty-title m-0 mb-16 w-full text-center text-24 font-semibold leading-tight tracking-tight text-text-primary max-narrow:mb-12 max-narrow:text-20"
          >
            {local.title}
          </h2>
        )}
        <div class="flex w-full flex-col items-center gap-12">
          {local.children}
          {local.hint && (
            <p class="chat-empty-hint m-0 max-w-full rounded-full border border-border-subtle bg-surface-muted px-12 py-6 text-center text-11 leading-normal text-text-muted">
              {local.hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
