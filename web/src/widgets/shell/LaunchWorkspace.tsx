import { createMemo, Show } from 'solid-js';
import { Button, Icon } from '../../components/ui';
import { readOnly } from '../../panel/lib/auth-state';
import { selectActiveProjects, selectArchivedProjects } from '../../features/catalog/project-catalog';
import { createProjectSession, creatingSessionProjectId, projects } from '../../panel/store';
import { QuickStartComposer } from '@/widgets/composer/QuickStartComposer';

interface LaunchWorkspaceProps {
  onOpenNavigation?: () => void;
  onCreateProject?: () => void;
  onImport?: (projectId: string) => void;
}

export function LaunchWorkspace(props: LaunchWorkspaceProps) {
  const activeProjects = createMemo(() => selectActiveProjects(projects()));
  const archivedProjects = createMemo(() => selectArchivedProjects(projects()));
  const emptyDescription = () => activeProjects().length
    ? 'Start a new session, or add an existing ACP session to the sidebar.'
    : archivedProjects().length
      ? 'Restore an archived project or create a new project to continue.'
      : 'Create a project first; Peri Studio saves and restores ACP sessions within it.';

  return <div class="launch-workspace relative flex min-h-0 flex-1 flex-col items-center overflow-hidden px-24 pb-20 text-center max-narrow:px-10 max-narrow:pb-10">
    <div class="launch-prompt pointer-events-none absolute inset-x-20 top-[42%] flex -translate-y-1/2 flex-col items-center">
      <div class="launch-mark mb-24 grid size-[50px] place-items-center text-text-faint" aria-hidden="true">
        <Icon class="size-[50px]!"><path d="M6.2 13.7A5.2 5.2 0 0 1 7 4.1a5.4 5.4 0 0 1 8.2 2.2 4.7 4.7 0 0 1 .6 8.9 5 5 0 0 1-8.7 1.1 5.2 5.2 0 0 1-.9-2.6Z" /><path d="m8.2 7.2 2.6 2.8-2.6 2.8M12.2 13h2.6" /></Icon>
      </div>
      <h2 class="m-0 text-28 font-normal leading-13 tracking-[-.035em] text-text-primary max-narrow:text-24">What do you want to build in Peri Studio?</h2>
      <span class="sr-only">Start with a clear prompt</span>
      <p class="sr-only">{emptyDescription()}</p>
    </div>
    <Show when={activeProjects().length === 0} fallback={
      <div class="launch-composer mt-auto w-full max-w-(--composer-launch-max)">
        <QuickStartComposer projects={activeProjects().map(({ id, name }) => ({ id, name }))} initialProjectId={activeProjects().length === 1 ? activeProjects()[0].id : undefined} />
        <div class="mt-7 flex min-h-32 items-center justify-center gap-4 text-11 text-text-muted">
          <Show when={activeProjects().length === 1}><Button size="compact" busy={creatingSessionProjectId() === activeProjects()[0].id} disabled={readOnly() || !!creatingSessionProjectId()} onClick={() => createProjectSession(activeProjects()[0].id)}>Start empty session</Button><span aria-hidden="true">·</span><Button size="compact" disabled={readOnly() || !props.onImport} onClick={() => props.onImport?.(activeProjects()[0].id)}>Import session</Button></Show>
          <Show when={activeProjects().length > 1}><Button size="compact" disabled={!props.onOpenNavigation} onClick={props.onOpenNavigation}>Browse projects and sessions</Button></Show>
        </div>
      </div>
    }>
      <Button class="mt-auto mb-32" variant="primary" disabled={readOnly() || !props.onCreateProject} onClick={props.onCreateProject}>New project</Button>
    </Show>
  </div>;
}
