import { createMemo, Show } from 'solid-js';
import { Button } from '@peri/ui';
import { ChatEmptyWorkspace, CHAT_EMPTY_TITLE } from '@/widgets/chat/ChatEmptyWorkspace';
import { readOnly } from '@/features/auth/auth-state';
import { selectActiveProjects, selectArchivedProjects } from '@/features/catalog/project-catalog';
import { createProjectSession, creatingSessionProjectId, projects } from '@/store';
import { QuickStartComposer } from '@/widgets/composer/QuickStartComposer';

interface LaunchWorkspaceProps {
  onOpenNavigation?: () => void;
  onCreateProject?: () => void;
  onImport?: (projectId: string) => void;
}

const EMPTY_HINT = 'Enter to send · Shift+Enter for newline';

export function LaunchWorkspace(props: LaunchWorkspaceProps) {
  const activeProjects = createMemo(() => selectActiveProjects(projects()));
  const archivedProjects = createMemo(() => selectArchivedProjects(projects()));
  const activeProjectOptions = createMemo(() =>
    activeProjects().map(({ id, name }) => ({ id, name }))
  );
  const hasActiveProjects = createMemo(() => activeProjects().length > 0);
  const singleActiveProject = createMemo(() =>
    activeProjects().length === 1 ? activeProjects()[0] : undefined
  );
  const hasMultipleActiveProjects = createMemo(() => activeProjects().length > 1);
  const emptyDescription = () => hasActiveProjects()
    ? 'Start a new session, or add an existing ACP session to the sidebar.'
    : archivedProjects().length
      ? 'Restore an archived project or create a new project to continue.'
      : 'Create a project first; Peri Studio saves and restores ACP sessions within it.';

  return (
    <ChatEmptyWorkspace title={hasActiveProjects() ? CHAT_EMPTY_TITLE : undefined} hint={hasActiveProjects() ? EMPTY_HINT : undefined}>
      <Show
        when={!hasActiveProjects()}
        fallback={(
          <div data-testid="launch-composer" class="w-full">
            <QuickStartComposer
              projects={activeProjectOptions}
              initialProjectId={() => singleActiveProject()?.id}
            />
            <div class="mt-4 flex min-h-36 flex-wrap items-center justify-center gap-8">
              <Show when={singleActiveProject()}>
                {(project) => (
                  <>
                    <Button size="compact" variant="ghost" busy={creatingSessionProjectId() === activeProjects()[0].id} disabled={readOnly() || !!creatingSessionProjectId()} onClick={() => createProjectSession(project().id)}>Start empty session</Button>
                    <Button size="compact" variant="ghost" disabled={readOnly() || !props.onImport} onClick={() => props.onImport?.(project().id)}>Import session</Button>
                  </>
                )}
              </Show>
              <Show when={hasMultipleActiveProjects()}>
                <Button size="compact" variant="ghost" disabled={!props.onOpenNavigation} onClick={props.onOpenNavigation}>Browse projects and sessions</Button>
              </Show>
            </div>
          </div>
        )}
      >
        <div class="flex w-full flex-col items-center gap-12 text-center">
          <p class="m-0 max-w-(--container-composer-launch) text-13 leading-relaxed text-text-muted">{emptyDescription()}</p>
          <Button variant="primary" disabled={readOnly() || !props.onCreateProject} onClick={props.onCreateProject}>New project</Button>
        </div>
      </Show>
    </ChatEmptyWorkspace>
  );
}
