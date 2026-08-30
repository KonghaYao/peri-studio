// 右区组装层：对话头部（ChatHeader）+ 消息区（MessageList）+ 发送窗口
// （Composer）。三个子组件各自独立文件，分别承载对话区功能演进：
//   - ChatHeader：title 点击 → ACP 会话列表 tooltip；对话操作 icon 收纳
//   - MessageList：reasoning 在前/正文在后；loading 状态组件
//   - Composer：模型/effort/上下文占用显示；session/new 新会话按钮
//
// 三段式 flex column（ui.md §四.4）：ChatHeader 固定顶部、MessageList
// flex-1 + min-h-0 承担滚动、Composer 固定在底部。onOpenNavigation /
// onOpenStatus 是纯 UI seam（ui.md §四.5，不涉及协议），透传给 ChatHeader
// 供中窄屏打开左右 drawer。

import { ChatHeader } from './ChatHeader';
import { Composer } from '@/widgets/composer/Composer';
import { MessageList } from './MessageList';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { chatEntries, chatHead, elicitationResponses, elicitations, permissions, refreshCurrentControlProjection, registryHydrated, resolvePermission, respondElicitation, restoringSessionId, retryPersistentAction, selectedSessionId, turnActive } from '../../panel/store';
import { readOnly } from '../../panel/lib/auth-state';
import { LoadingState } from '../../components/ui';
import { ConnectionProblem } from '@/widgets/shell/ConnectionProblem';
import { ErrorCenter } from '@/widgets/shell/ErrorCenter';
import { LaunchWorkspace } from '@/widgets/shell/LaunchWorkspace';
import { StatusArea } from '@/widgets/shell/StatusArea';
import { ElicitationQueue } from './ElicitationQueue';
import { dismissUncertainElicitation, visibleElicitations } from '../../panel/lib/elicitation-delivery';
import { PermissionQueue } from './PermissionQueue';
import { permissionDecisions } from '../../panel/lib/permission-delivery';

type ChatViewProps = {
  onOpenNavigation?: () => void;
  onCreateProject?: () => void;
  onImport?: (projectId: string) => void;
  onOpenResources?: () => void;
};

export function ChatView(props: ChatViewProps) {
  const [composerHeight, setComposerHeight] = createSignal(0);
  let composerStack: HTMLDivElement | undefined;
  let composerObserver: ResizeObserver | undefined;
  const hasPendingPermission = () => permissions().some((permission) => permission.status === 'pending');
  const hasPendingElicitation = () => visibleElicitations(elicitations()).length > 0;
  onMount(() => {
    if (!composerStack || typeof ResizeObserver === 'undefined') return;
    const updateHeight = () => setComposerHeight(composerStack?.getBoundingClientRect().height ?? 0);
    updateHeight();
    composerObserver = new ResizeObserver(updateHeight);
    composerObserver.observe(composerStack);
  });
  onCleanup(() => composerObserver?.disconnect());
  return (
    <section class={`chat-view relative flex h-full min-h-0 flex-col bg-app-bg ${selectedSessionId() ? '' : 'chat-view--launch'}`}>
      <ChatHeader
        launch={!selectedSessionId()}
        onOpenNavigation={props.onOpenNavigation}
        onOpenResources={props.onOpenResources}
      />
      <ConnectionProblem />
      <ErrorCenter />
      <Show when={restoringSessionId()}><LoadingState label="Restoring last session and ACP context…" class="restore-banner justify-center mt-12 mx-20 max-narrow:m-10" /></Show>
      <Show when={selectedSessionId()} fallback={<Show
        when={registryHydrated()}
        fallback={<LoadingState label="Loading projects" class="flex-1 justify-center text-center" />}
      >
        <LaunchWorkspace onOpenNavigation={props.onOpenNavigation} onCreateProject={props.onCreateProject} onImport={props.onImport} />
      </Show>}>
        <div class="chat-workspace relative flex min-h-0 flex-1 flex-col">
          <MessageList footerHeight={composerHeight()} />
          <div ref={composerStack} class="composer-stack relative z-20 flex-none bg-app-bg">
            <Show when={hasPendingPermission()}>
              <PermissionQueue
                permissions={permissions().filter((permission) => permission.status === 'pending')}
                decisions={permissionDecisions()}
                readOnly={readOnly()}
                onResolve={resolvePermission}
                onRetry={retryPersistentAction}
              />
            </Show>
            <Show when={!hasPendingPermission()}>
              <ElicitationQueue
                elicitations={visibleElicitations(elicitations())}
                responses={elicitationResponses()}
                readOnly={readOnly()}
                onRefreshStatus={refreshCurrentControlProjection}
                onDismissUncertain={dismissUncertainElicitation}
                onRespond={respondElicitation}
              />
            </Show>
            <Show when={!hasPendingPermission() && !hasPendingElicitation()}>
              <StatusArea active={turnActive()} plan={chatHead()?.agent?.plan ?? []} activities={chatHead()?.agent?.activities ?? []} entries={chatEntries()} />
            </Show>
            <Composer />
          </div>
        </div>
      </Show>
    </section>
  );
}
