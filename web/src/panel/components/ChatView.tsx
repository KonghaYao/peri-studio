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
import { Button, Icon, LoadingState } from '../../components/ui';
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
    <section class={`chat-view relative flex h-full min-h-0 flex-col bg-app-bg ${selectedSessionId() ? '' : 'chat-view--launch'}`}>
      <ChatHeader
        launch={!selectedSessionId()}
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
        <div class="launch-workspace relative flex min-h-0 flex-1 flex-col items-center overflow-hidden px-24 pb-20 text-center max-narrow:px-10 max-narrow:pb-10">
          <div class="launch-prompt pointer-events-none absolute inset-x-20 top-[42%] flex -translate-y-1/2 flex-col items-center">
            <div class="launch-mark mb-24 grid size-[50px] place-items-center text-text-faint" aria-hidden="true">
              <Icon class="size-[50px]!" ><path d="M6.2 13.7A5.2 5.2 0 0 1 7 4.1a5.4 5.4 0 0 1 8.2 2.2 4.7 4.7 0 0 1 .6 8.9 5 5 0 0 1-8.7 1.1 5.2 5.2 0 0 1-.9-2.6Z" /><path d="m8.2 7.2 2.6 2.8-2.6 2.8M12.2 13h2.6" /></Icon>
            </div>
            <h2 class="m-0 text-28 font-normal leading-13 tracking-[-.035em] text-text-primary max-narrow:text-24">What do you want to build in Peri Studio?</h2>
            <span class="sr-only">Start with a clear prompt</span>
            <p class="sr-only">{emptyDescription()}</p>
          </div>
          <Show when={activeProjects().length === 0} fallback={
            <div class="launch-composer mt-auto w-full max-w-(--composer-launch-max)">
              <QuickStartComposer projects={activeProjects().map(({ id, name }) => ({ id, name }))} initialProjectId={activeProjects().length === 1 ? activeProjects()[0].id : undefined} />
              <div class="mt-7 flex min-h-32 items-center justify-center gap-4 text-11 text-text-muted">
                <Show when={activeProjects().length === 1}><Button size="compact" busy={creatingSessionProjectId() === activeProjects()[0].id} disabled={readOnly() || !!creatingSessionProjectId()} onClick={() => createProjectSession(activeProjects()[0].id)}>Start empty session</Button><span aria-hidden="true">·</span><Button size="compact" disabled={readOnly()} onClick={() => props.onImport?.(activeProjects()[0].id)}>Import session</Button></Show>
                <Show when={activeProjects().length > 1}><Button size="compact" onClick={props.onOpenNavigation}>Browse projects and sessions</Button></Show>
              </div>
            </div>
          }>
            <Button class="mt-auto mb-32" variant="primary" disabled={readOnly()} onClick={props.onCreateProject}>New project</Button>
          </Show>
        </div>
      </Show>}>
        <div class="chat-workspace relative flex min-h-0 flex-1 flex-col">
          <AgentActivityRail activities={chatHead()?.agent?.activities ?? []} />
          <AgentPlanPanel entries={chatHead()?.agent?.plan ?? []} />
          <MessageList bottomInset={composerHeight()} />
          <div ref={composerStack} class="composer-stack composer-stack--overlay pointer-events-none absolute right-0 bottom-0 left-0 z-20 bg-app-bg [&>*]:pointer-events-auto">
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
