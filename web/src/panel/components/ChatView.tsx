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
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { chatHead, createProjectSession, creatingSessionProjectId, elicitationResponses, elicitations, projects, registryHydrated, respondElicitation, restoringSessionId, selectedSessionId } from '../store';
import { readOnly } from '../lib/auth-state';
import { Button, EmptyState, LoadingState } from '../../components/ui';
import { ConnectionProblem } from './ConnectionProblem';
import { ErrorCenter } from './ErrorCenter';
import { QuickStartComposer } from './QuickStartComposer';
import { AgentActivityRail } from './AgentActivityRail';
import { AgentPlanPanel } from './AgentPlanPanel';
import { ElicitationQueue } from './ElicitationQueue';

type ChatViewProps = {
  onOpenNavigation?: () => void;
  onOpenSystem?: () => void;
  onCreateProject?: () => void;
  onImport?: (projectId: string) => void;
};

export function ChatView(props: ChatViewProps) {
  const [composerHeight, setComposerHeight] = createSignal(0);
  let composerStack: HTMLDivElement | undefined;
  let composerObserver: ResizeObserver | undefined;
  onMount(() => {
    if (!composerStack || typeof ResizeObserver === 'undefined') return;
    const updateHeight = () => setComposerHeight(composerStack?.getBoundingClientRect().height ?? 0);
    updateHeight();
    composerObserver = new ResizeObserver(updateHeight);
    composerObserver.observe(composerStack);
  });
  onCleanup(() => composerObserver?.disconnect());
  const activeProjects = createMemo(() => projects().filter((project) => !project.archivedAt));
  const hasArchivedProjects = createMemo(() => projects().some((project) => !!project.archivedAt));
  const emptyDescription = () => activeProjects().length
    ? 'Start a new session, or add an existing ACP session to the sidebar.'
    : hasArchivedProjects()
      ? 'Restore an archived project or create a new project to continue.'
      : 'Create a project first; Peri Studio saves and restores ACP sessions within it.';
  return (
    <section class="chat-view flex h-full min-h-0 flex-col">
      <ChatHeader
        onOpenNavigation={props.onOpenNavigation}
        onOpenSystem={props.onOpenSystem}
      />
      <ConnectionProblem />
      <ErrorCenter />
      <Show when={restoringSessionId()}><LoadingState label="Restoring last session and ACP context…" class="restore-banner justify-center mt-12 mx-20 max-narrow:m-10" /></Show>
      <Show when={selectedSessionId()} fallback={<Show
        when={registryHydrated()}
        fallback={<LoadingState label="Loading projects" description="Syncing projects and sessions from the Peri Studio server…" class="flex-1 justify-center text-center" />}
      >
        <EmptyState title="Start with a clear prompt" description={emptyDescription()} action={
        <div class="empty-actions">
          <Show when={activeProjects().length === 0}><Button variant="primary" disabled={readOnly()} onClick={props.onCreateProject}>New project</Button></Show>
          <Show when={activeProjects().length > 0}><QuickStartComposer projects={activeProjects().map(({ id, name }) => ({ id, name }))} initialProjectId={activeProjects().length === 1 ? activeProjects()[0].id : undefined} /><div class="empty-secondary-actions"><Show when={activeProjects().length === 1}><Button busy={creatingSessionProjectId() === activeProjects()[0].id} disabled={readOnly() || !!creatingSessionProjectId()} onClick={() => createProjectSession(activeProjects()[0].id)}>Start empty session</Button><Button disabled={readOnly()} onClick={() => props.onImport?.(activeProjects()[0].id)}>Import existing session</Button></Show><Show when={activeProjects().length > 1}><Button onClick={props.onOpenNavigation}>Browse projects and sessions</Button></Show></div></Show>
        </div>
        } />
      </Show>}>
        <div class="chat-workspace relative flex min-h-0 flex-1 flex-col">
          <AgentActivityRail activities={chatHead()?.agent?.activities ?? []} />
          <AgentPlanPanel entries={chatHead()?.agent?.plan ?? []} />
          <MessageList bottomInset={composerHeight()} />
          <div ref={composerStack} class="composer-stack composer-stack--overlay absolute right-0 bottom-0 left-0 z-20">
            <ElicitationQueue
              elicitations={elicitations()}
              responding={elicitationResponses()}
              readOnly={readOnly()}
              onRespond={respondElicitation}
            />
            <Composer />
          </div>
        </div>
      </Show>
    </section>
  );
}
