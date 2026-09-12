// 右区组装层：@peri/ui ChatWorkspaceShell + ChatHeader、MessageList、Composer。
// T4 保留 store/features 逻辑；布局 chrome 下沉 T3 ChatWorkspaceShell。

import {
  BackToTop,
  chatColumnClass,
  chatComposerStackChildClass,
  chatDecisionPanelClass,
  chatFloatingAnchorClass,
  ChatHeader as ChatHeaderBase,
  ChatWorkspaceShell,
  InlineNotice,
  LoadingState,
  cn,
} from '@peri/ui';
import { resolveChatHeaderTitle } from '@/features/chat/chat-header-title';
import { Composer } from '@/widgets/composer/Composer';
import { MessageList, type MessageListFollowState } from './MessageList';
import { ChatEmptyWorkspace, CHAT_EMPTY_TITLE } from './ChatEmptyWorkspace';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { chatCatalog, chatEntries, chatAgentLoading, chatHead, elicitationResponses, elicitations, permissions, projectSessions, questionResponses, questions, refreshCurrentControlProjection, registryHydrated, resolvePermission, respondElicitation, respondQuestion, restoringSessionId, retryPersistentAction, runtimeDocsHydrated, selectedCid, selectedSessionId, turnActive } from '@/store';
import { readOnly } from '@/features/auth/auth-state';
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
  const [followState, setFollowState] = createSignal<MessageListFollowState>({
    awayFromLatest: false,
    hasNewContent: false,
  });
  let composerStack: HTMLDivElement | undefined;
  let composerObserver: ResizeObserver | undefined;
  let jumpToLatest: (() => void) | undefined;
  const hasPendingPermission = () => permissions().some((permission) => permission.status === 'pending');
  const hasPendingElicitation = () => visibleElicitations(elicitations()).length > 0;
  const hasPendingQuestion = () => visibleQuestions(questions()).length > 0;
  const showBackToTop = createMemo(() => {
    const state = followState();
    const blocked = hasPendingPermission() || hasPendingElicitation() || hasPendingQuestion();
    return (state.awayFromLatest || state.hasNewContent) && !blocked;
  });
  const projectCwd = createMemo(() => chatCatalog().find((chat) => chat.id === selectedCid())?.cwd ?? null);
  const headerTitle = createMemo(() => resolveChatHeaderTitle({
    sessions: projectSessions(),
    selectedSessionId: selectedSessionId(),
    chatHead: chatHead(),
  }));
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
        class={cn(chatColumnClass, 'mb-8')}
        data-testid="agent-public-error-notice"
      >
        <code class="whitespace-pre-wrap wrap-anywhere font-mono text-12 leading-normal">
          {notice.code || 'UNKNOWN'}{notice.message ? `: ${notice.message}` : ''}
        </code>
      </InlineNotice>
    );
  };
  const queueAndStatus = () => (
    <>
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
    </>
  );
  onMount(() => {
    if (!composerStack || typeof ResizeObserver === 'undefined') return;
    const updateHeight = () => setComposerHeight(composerStack?.getBoundingClientRect().height ?? 0);
    updateHeight();
    composerObserver = new ResizeObserver(updateHeight);
    composerObserver.observe(composerStack);
  });
  onCleanup(() => composerObserver?.disconnect());
  return (
    <ChatWorkspaceShell
      data-testid="chat-view"
      launch={!selectedSessionId()}
      header={(
        <ChatHeaderBase
          title={headerTitle()}
          launch={!selectedSessionId()}
          navButtonClass="hidden"
          showMobileNav
          showMobileResources
          onOpenNavigation={props.onOpenNavigation}
          onOpenResources={props.onOpenResources}
        />
      )}
      banner={(
        <>
          <ConnectionProblem />
          <ErrorCenter />
          <Show when={restoringSessionId()}>
            <LoadingState label="Restoring last session and ACP context…" class="justify-center mt-12 mx-20 max-narrow:m-10" data-testid="restore-banner" />
          </Show>
        </>
      )}
      launchBody={(
        <Show
          when={registryHydrated()}
          fallback={<LoadingState label="Loading projects" class="flex-1 justify-center text-center" />}
        >
          <LaunchWorkspace onOpenNavigation={props.onOpenNavigation} onCreateProject={props.onCreateProject} onImport={props.onImport} />
        </Show>
      )}
      transcript={selectedSessionId() ? (
        <Show
          when={conversationEmpty()}
          fallback={(
            <MessageList
              footerHeight={composerHeight()}
              onFollowStateChange={setFollowState}
              onRegisterJumpToLatest={(jump) => {
                jumpToLatest = jump;
              }}
            />
          )}
        >
          <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
            {queueAndStatus()}
            <ChatEmptyWorkspace title={CHAT_EMPTY_TITLE} hint={EMPTY_HINT}>
              <Composer layout="centered" renderRuntimeMenu={composerRuntimeMenu} />
            </ChatEmptyWorkspace>
          </div>
        </Show>
      ) : undefined}
      composerStack={selectedSessionId() && !conversationEmpty() ? (
        <>
          <div class={chatDecisionPanelClass} data-testid="decision-panel">
            {queueAndStatus()}
          </div>
          <div class={cn(chatFloatingAnchorClass, chatComposerStackChildClass)}>
            <BackToTop
              visible={showBackToTop()}
              label={followState().hasNewContent ? 'New content' : 'Back to latest'}
              onClick={() => jumpToLatest?.()}
              data-testid="back-to-latest"
            />
            <Composer renderRuntimeMenu={composerRuntimeMenu} />
          </div>
        </>
      ) : undefined}
      composerStackRef={(element) => {
        composerStack = element;
      }}
    />
  );
}
