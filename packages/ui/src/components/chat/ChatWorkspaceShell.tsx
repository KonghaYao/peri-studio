import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';

export type ChatWorkspaceShellProps = {
  class?: string;
  /** 无选中 session 的启动态（对应生产 `chat-view--launch`）。 */
  launch?: boolean;
  header?: JSX.Element;
  /** 连接/错误/恢复等顶栏下方横幅区。 */
  banner?: JSX.Element;
  /** 启动态主内容（无 session 时替代 transcript + composerStack）。 */
  launchBody?: JSX.Element;
  /** 会话主栏：消息列表或空会话列。 */
  transcript?: JSX.Element;
  /** 贴底区：队列、状态与 Composer（空会话时省略，由 transcript 承载）。 */
  composerStack?: JSX.Element;
  composerStackRef?: (element: HTMLDivElement | undefined) => void;
  'data-testid'?: string;
};

/** T3 · Chat 工作区壳：顶栏 + 横幅 + 可滚动 transcript + 贴底 composerStack。 */
export const ChatWorkspaceShell: Component<ChatWorkspaceShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'launch',
    'header',
    'banner',
    'launchBody',
    'transcript',
    'composerStack',
    'composerStackRef',
  ]);

  return (
    <section
      {...rest}
      class={cn(
        'ui-chat-workspace chat-view relative flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-app-bg',
        local.launch && 'ui-chat-workspace--launch chat-view--launch',
        local.class,
      )}
    >
      {local.header}
      {local.banner}
      <Show
        when={!local.launch}
        fallback={local.launchBody}
      >
        <div class="ui-chat-workspace__session chat-workspace relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
          {local.transcript}
          <Show when={local.composerStack}>
            <div
              ref={local.composerStackRef}
              class="ui-chat-workspace__bottom-stack composer-stack relative z-20 flex-none min-w-0 overflow-x-hidden bg-app-bg"
              data-testid="composer-stack"
            >
              {local.composerStack}
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
};
