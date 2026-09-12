import { splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type ChatActivityChainProps = {
  class?: string;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  children?: JSX.Element;
};

/** T3 · 助手 activity 列：正文 / 工具 / 推理共用块级间距与延续轨。 */
export const ChatActivityChain: Component<ChatActivityChainProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'continuesBefore', 'continuesAfter', 'children']);

  return (
    <div
      data-testid="chat-activity-chain"
      class={cn('ui-chat-activity-chain', local.class)}
      {...rest}
    >
      <span
        class="ui-chat-activity-rail"
        data-testid="chat-activity-rail"
        data-continue-before={local.continuesBefore ? 'true' : undefined}
        data-continue-after={local.continuesAfter ? 'true' : undefined}
        aria-hidden="true"
      />
      {local.children}
    </div>
  );
};
