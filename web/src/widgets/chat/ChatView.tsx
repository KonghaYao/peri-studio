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
import { ChatEmptyWorkspace, CHAT_EMPTY_TITLE } from './ChatEmptyWorkspace';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { chatCatalog, chatEntries, chatAgentLoading, chatHead, elicitationResponses, elicitations, permissions, questionResponses, questions, refreshCurrentControlProjection, registryHydrated, resolvePermission, respondElicitation, respondQuestion, restoringSessionId, retryPersistentAction, runtimeDocsHydrated, selectedCid, selectedSessionId, turnActive } from '@/store';
import { readOnly } from '@/features/auth/auth-state';
import { InlineNotice, LoadingState } from '@/shared/ui';
import { selectAgentPublicErrorNotice } from '@/features/chat/agent-public-error-notice';
import { ConnectionProblem } from '@/widgets/shell/ConnectionProblem';
import { ErrorCenter } from '@/widgets/shell/ErrorCenter';
import { LaunchWorkspace } from '@/widgets/shell/LaunchWorkspace';
import { SessionModelMenu } from '@/widgets/shell/SessionConfigDialog';
import { StatusArea } from '@/widgets/shell/StatusArea';
import { ElicitationQueue } from './ElicitationQueue';
import { QuestionQueue } from './QuestionQueue';
import { dismissUncertainElicitation, visibleElicitations } from '@/features/message/elicitation-delivery';
import { dismissUncertainQuestion, visibleQuestions } from '@/features/message/question-delivery';
import { PermissionQueue } from './PermissionQueue';
import { permissionDecisions } from '@/features/message/permission-delivery';
import { messageSubmission } from '@/features/message/message-delivery';
import { isConversationEmpty } from '@/features/chat/conversation-empty';

const EMPTY_HINT = 'Enter to send · Shift+Enter for newline';

function composerRuntimeMenu(ctx: { id: string; disabled: boolean }) {
  return <SessionModelMenu id={ctx.id} disabled={ctx.disabled} />;
}

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
  const hasPendingQuestion = () => visibleQuestions(questions()).length > 0;
  const projectCwd = createMemo(() => chatCatalog().find((chat) => chat.id === selectedCid())?.cwd ?? null);
  const conversationEmpty = createMemo(() => isConversationEmpty({
    runtimeDocsHydrated: runtimeDocsHydrated(),
    entryCount: chatEntries().length,
    turnActive: turnActive(),
    hasSubmission: !!messageSubmission(selectedSessionId()),
    restoring: !!restoringSessionId(),
    chatLoading: chatAgentLoading(),
  }));
  const agentPublicErrorNotice = createMemo(() => selectAgentPublicErrorNotice(
    chatHead()?.agent,
    turnActive(),
    chatEntries(),
  ));
  const agentPublicErrorBanner = () => {
    const notice = agentPublicErrorNotice();
    if (!notice) return null;
    return (
      <InlineNotice
        tone="danger"
        role="alert"
        aria-label="Agent error"
        class="chat-column mx-auto mb-8 w-full max-w-(--chat-content-max)"
        data-testid="agent-public-error-notice"
      >
        <code class="whitespace-pre-wrap wrap-anywhere font-mono text-12 leading-normal">
          {notice.code || 'UNKNOWN'}{notice.message ? `: ${notice.message}` : ''}
        </code>
      </InlineNotice>
    );
  };
  onMount(() => {
    if (!composerStack || typeof ResizeObserver === 'undefined') return;
    const updateHeight = () => setComposerHeight(composerStack?.getBoundingClientRect().height ?? 0);
    updateHeight();
    composerObserver = new ResizeObserver(updateHeight);
    composerObserver.observe(composerStack);
  });
  onCleanup(() => composerObserver?.disconnect());
  return (
    <section class={`chat-view relative flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-app-bg ${selectedSessionId() ? '' : 'chat-view--launch'}`} data-testid="chat-view">
      <ChatHeader
        launch={!selectedSessionId()}
        onOpenNavigation={props.onOpenNavigation}
        onOpenResources={props.onOpenResources}
      />
      <ConnectionProblem />
      <ErrorCenter />
      <Show when={restoringSessionId()}><LoadingState label="Restoring last session and ACP context…" class="restore-banner justify-center mt-12 mx-20 max-narrow:m-10" data-testid="restore-banner" /></Show>
      <Show when={selectedSessionId()} fallback={<Show
        when={registryHydrated()}
        fallback={<LoadingState label="Loading projects" class="flex-1 justify-center text-center" />}
      >
        <LaunchWorkspace onOpenNavigation={props.onOpenNavigation} onCreateProject={props.onCreateProject} onImport={props.onImport} />
      </Show>}>
        <div class="chat-workspace relative flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
          <Show when={conversationEmpty()} fallback={(
            <>
              <MessageList footerHeight={composerHeight()} />
              <div ref={composerStack} class="composer-stack relative z-20 flex-none min-w-0 overflow-x-hidden bg-app-bg" data-testid="composer-stack">
                <Show when={hasPendingPermission()}>
                  <PermissionQueue
                    permissions={permissions().filter((permission) => permission.status === 'pending')}
                    decisions={permissionDecisions()}
                    readOnly={readOnly()}
                    onResolve={resolvePermission}
                    onRetry={retryPersistentAction}
                  />
                </Show>
                <Show when={hasPendingElicitation()}>
                  <ElicitationQueue
                    elicitations={visibleElicitations(elicitations())}
                    responses={elicitationResponses()}
                    readOnly={readOnly()}
                    onRefreshStatus={refreshCurrentControlProjection}
                    onDismissUncertain={dismissUncertainElicitation}
                    onRespond={respondElicitation}
                  />
                </Show>
                <Show when={hasPendingQuestion()}>
                  <QuestionQueue
                    questions={visibleQuestions(questions())}
                    responses={questionResponses()}
                    readOnly={readOnly()}
                    onRefreshStatus={refreshCurrentControlProjection}
                    onDismissUncertain={dismissUncertainQuestion}
                    onRespond={respondQuestion}
                  />
                </Show>
                {agentPublicErrorBanner()}
                <StatusArea active={turnActive()} plan={chatHead()?.agent?.plan ?? []} activities={chatHead()?.agent?.activities ?? []} tasks={chatHead()?.tasks ?? []} entries={chatEntries()} projectCwd={projectCwd()} />
                <Composer renderRuntimeMenu={composerRuntimeMenu} />
              </div>
            </>
          )}>
            <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
              <Show when={hasPendingPermission()}>
                <PermissionQueue
                  permissions={permissions().filter((permission) => permission.status === 'pending')}
                  decisions={permissionDecisions()}
                  readOnly={readOnly()}
                  onResolve={resolvePermission}
                  onRetry={retryPersistentAction}
                />
              </Show>
              <Show when={hasPendingElicitation()}>
                <ElicitationQueue
                  elicitations={visibleElicitations(elicitations())}
                  responses={elicitationResponses()}
                  readOnly={readOnly()}
                  onRefreshStatus={refreshCurrentControlProjection}
                  onDismissUncertain={dismissUncertainElicitation}
                  onRespond={respondElicitation}
                />
              </Show>
              <Show when={hasPendingQuestion()}>
                <QuestionQueue
                  questions={visibleQuestions(questions())}
                  responses={questionResponses()}
                  readOnly={readOnly()}
                  onRefreshStatus={refreshCurrentControlProjection}
                  onDismissUncertain={dismissUncertainQuestion}
                  onRespond={respondQuestion}
                />
              </Show>
              {agentPublicErrorBanner()}
              <StatusArea active={turnActive()} plan={chatHead()?.agent?.plan ?? []} activities={chatHead()?.agent?.activities ?? []} tasks={chatHead()?.tasks ?? []} entries={chatEntries()} projectCwd={projectCwd()} />
              <ChatEmptyWorkspace title={CHAT_EMPTY_TITLE} hint={EMPTY_HINT}>
                <Composer layout="centered" renderRuntimeMenu={composerRuntimeMenu} />
              </ChatEmptyWorkspace>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}
