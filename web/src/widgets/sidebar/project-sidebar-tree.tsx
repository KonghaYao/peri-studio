import { For, Show } from 'solid-js';
import {
  Button,
  buttonGroupItemClass,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  LoadingState,
} from '@peri/ui';
import { CloudOff, Folder, FolderOpen, ListFilter, Pin } from 'lucide-solid';
import { createProjectSession, creatingSessionProjectId, discoveringSessionsProjectId, isProjectCatalogBootstrapPending, projectSessions, readOnly } from '@/store';
import { ProjectRowAccessory, ProjectRowActionGroup, SectionHeader } from '@peri/ui';
import { ArchiveIcon, ImportIcon, MoreIcon, PlusIcon, RenameIcon } from './project-sidebar-icons';
import { ProjectSidebarRow } from './project-sidebar-row';
import type { ProjectSidebarModel } from './project-sidebar-model';

export interface ProjectSidebarTreeProps {
  model: ProjectSidebarModel;
  onNavigate?: () => void;
}

export function ProjectSidebarTree(props: ProjectSidebarTreeProps) {
  const { model } = props;
  return (
    <Show
      when={model.registryHydrated()}
      fallback={<LoadingState label="Loading projects" class="sidebar-loading px-2.5 py-2 text-left!" />}
    >
      <Show when={model.pinnedSessions().length > 0}>
        <SectionHeader title="Pinned" icon={<Pin size={14} strokeWidth={1.7} />} />
        <div class="flex flex-col gap-2 pb-1">
          <For each={model.pinnedSessions().map((session) => session.id)}>
            {(sessionId) => {
              const session = () => model.pinnedSessions().find((item) => item.id === sessionId)!;
              return (
                <ProjectSidebarRow
                  model={model}
                  session={session()}
                  projectId={session().projectId}
                  options={{ pinned: true }}
                  onNavigate={props.onNavigate}
                />
              );
            }}
          </For>
        </div>
      </Show>

      <SectionHeader title="Workspaces">
        <IconButton size="sm" showTooltip={false} label="Filter workspaces" class="size-28 shrink-0 text-content-muted" onClick={() => model.setSearchOpen(true)}>
          <ListFilter size={15} strokeWidth={1.7} />
        </IconButton>
        <IconButton size="sm" showTooltip={false} label="New workspace" class="new-project-button size-28 shrink-0 text-content-muted" disabled={readOnly()} onClick={() => model.openCreateProject()}>
          <Folder size={15} strokeWidth={1.7} />
        </IconButton>
      </SectionHeader>

      <Show
        when={model.instanceGroups().length > 0}
        fallback={<EmptyState
          variant="inline"
          class="sidebar-empty px-2.5 py-2 text-left!"
          title={model.projects().length ? 'No active projects' : 'No projects yet'}
          description={model.projects().length ? 'Restore an archived project to continue.' : 'No connected instances or projects are available.'}
        />}
      >
        <For each={model.instanceIds()}>{(instanceId) => {
          const instance = () => model.instanceGroups().find((item) => item.id === instanceId)!;
          return <section class="instance-group group/instance pb-1">
            <div class="instance-row group/instance relative flex min-h-28 items-center gap-8 pl-2.5 pr-4 text-11 text-content-muted">
              <span class="instance-name min-w-0 flex-1 truncate">{instance().name}</span>
              <Show when={instance().offline}>
                <span class="instance-offline flex shrink-0 items-center gap-4 text-danger-solid" role="img" aria-label="Instance offline">
                  <CloudOff size={13} strokeWidth={1.8} aria-hidden="true" />
                  <span>Offline</span>
                </span>
              </Show>
              <IconButton
                size="sm"
                showTooltip={false}
                class="new-project-button instance-create-action pointer-events-none absolute right-4 top-1/2 size-28 -translate-y-1/2 border-0 bg-transparent text-content-muted opacity-0 transition-opacity duration-(--duration-fast) group-hover/instance:pointer-events-auto group-hover/instance:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-coarse:size-36 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
                label="New project"
                disabled={readOnly()}
                onClick={() => model.openCreateProject(instanceId)}
              >
                <PlusIcon />
              </IconButton>
            </div>
            <For each={instance().projects.map((project) => project.id)}>{(projectId) => {
              const project = () => instance().projects.find((item) => item.id === projectId)!;
              const sessions = () => projectSessions().filter((s) => s.projectId === projectId && !s.archivedAt);
              const archivedSessions = () => projectSessions().filter((s) => s.projectId === projectId && !!s.archivedAt);
              const sessionsLoading = () => discoveringSessionsProjectId() === projectId || isProjectCatalogBootstrapPending(projectId);
              const collapsed = () => model.collapsedProjects().has(projectId);
              const open = () => !collapsed();
              const hasSessions = () => sessions().length > 0;
              const projectMenuId = `project-menu-${projectId}`;
              return <Collapsible as="section" class="project-group min-w-0" open={open()} onOpenChange={(next) => model.setProjectCollapsed(projectId, !next)}>
                <div class="group/workspace relative min-w-0 rounded-md hover:bg-interaction-hover focus-within:bg-interaction-hover">
                  <CollapsibleTrigger class="relative z-0 flex w-full min-w-0 items-start gap-8 pl-2.5 pr-(--sidebar-row-accessory-pr-workspace) py-4 text-left" aria-label={project().name}>
                    <span class="mt-0.5 shrink-0 text-content-muted">
                      <Show when={open()} fallback={<Folder size={15} strokeWidth={1.7} />}>
                        <FolderOpen size={15} strokeWidth={1.7} />
                      </Show>
                    </span>
                    <span class="min-w-0 flex-1 py-0.5">
                      <span class="min-w-0 flex-1 truncate text-13 text-content-primary">{project().name}</span>
                    </span>
                  </CollapsibleTrigger>
                  <ProjectRowAccessory count={hasSessions() ? sessions().length : undefined} actionsVisible={model.projectMenu() === projectId}>
                    <ProjectRowActionGroup>
                      <DropdownMenu open={model.projectMenu() === projectId} onOpenChange={(next) => model.setProjectMenu(next ? projectId : null)} placement="bottom-end">
                        <DropdownMenuTrigger
                          as={IconButton}
                          size="sm"
                          showTooltip={false}
                          class={`${buttonGroupItemClass} project-menu-trigger`}
                          label={`${project().name} actions`}
                          disabled={readOnly()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <MoreIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent id={projectMenuId} aria-label={`${project().name} actions`} class="ui-menu">
                          <DropdownMenuItem onSelect={() => { model.setProjectNameDraft(project().name); model.setRenamingProject(projectId); }}><RenameIcon />Rename project</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => model.setImportingProject(projectId)}><ImportIcon />Import existing session</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => model.setArchivedBrowserProjectId(projectId)}>
                            <ArchiveIcon />
                            Archived
                            <Show when={archivedSessions().length > 0}>
                              <span class="ml-auto text-11 text-content-muted">{archivedSessions().length}</span>
                            </Show>
                          </DropdownMenuItem>
                          <DropdownMenuItem class="text-danger focus:text-danger" disabled={model.projectHasRunningSession(projectId)} onSelect={() => model.setArchiveCandidate(projectId)}><ArchiveIcon />Archive project</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <IconButton
                        size="sm"
                        showTooltip={false}
                        class={`${buttonGroupItemClass} row-create-action`}
                        label={`New session in ${project().name}`}
                        busy={creatingSessionProjectId() === projectId}
                        disabled={readOnly() || !!creatingSessionProjectId()}
                        onClick={(event) => {
                          event.stopPropagation();
                          createProjectSession(projectId);
                        }}
                      >
                        <PlusIcon />
                      </IconButton>
                    </ProjectRowActionGroup>
                  </ProjectRowAccessory>
                </div>
                <CollapsibleContent id={`project-sessions-${projectId}`} data-testid="session-list" class="session-list flex flex-col gap-2 pb-1">
                  <Show
                    when={hasSessions()}
                    fallback={<Show
                      when={sessionsLoading()}
                      fallback={<Button
                        variant="ghost"
                        size="compact"
                        class="session-empty ui-sidebar-mist-hint h-auto justify-start px-2.5 py-4 pl-36 text-left text-11 font-normal hover:bg-transparent hover:text-content-muted"
                        disabled={readOnly() || !!creatingSessionProjectId()}
                        onClick={() => createProjectSession(projectId)}
                      >
                        Start your first conversation
                      </Button>}
                    >
                      <LoadingState label="Loading sessions" class="session-empty px-2.5 py-4 pl-36 text-left!" />
                    </Show>}
                  >
                    <For each={sessions().map((item) => item.id)}>
                      {(sessionId) => {
                        const session = () => sessions().find((item) => item.id === sessionId)!;
                        return (
                          <ProjectSidebarRow
                            model={model}
                            session={session()}
                            projectId={projectId}
                            options={{ indent: 16 }}
                            onNavigate={props.onNavigate}
                          />
                        );
                      }}
                    </For>
                  </Show>
                </CollapsibleContent>
              </Collapsible>;
            }}</For>
          </section>;
        }}</For>
      </Show>
    </Show>
  );
}
