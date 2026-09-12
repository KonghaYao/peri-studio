import { splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type ChatActivityChainProps = {
  class?: string;
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  children?: JSX.Element;
};

/** T3 · 助手 activity 列：推理 / 工具行共用左侧轨与块级间距。 */
export const ChatActivityChain: Component<ChatActivityChainProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'continuesBefore', 'continuesAfter', 'children']);

  return (
    <div
      data-testid="chat-activity-chain"
      class={cn('relative isolate grid w-full min-w-0 gap-16 my-0', local.class)}
      {...rest}
    >
      <span
        class="absolute top-0 bottom-0 left-(--chat-activity-rail-left) z-0 w-px bg-border-strong data-[continue-before=true]:-top-10 data-[continue-after=true]:-bottom-16"
        data-testid="chat-activity-rail"
        data-continue-before={local.continuesBefore ? 'true' : undefined}
        data-continue-after={local.continuesAfter ? 'true' : undefined}
        aria-hidden="true"
      />
      {local.children}
    </div>
  );
};
