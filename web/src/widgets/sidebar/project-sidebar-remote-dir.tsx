import { For, Show } from 'solid-js';
import { Button, Dialog, DialogContent, DialogTitle, TextField } from '@peri/ui';
import { runConfirmedMutation } from '@/features/session/form-mutation';
import { projectNameFromPath } from '@/shared/lib/project-path';
import { isLocalMachine } from '@/entities/machine/machine-view';
import { projects, remoteDirectoryBrowsePorts } from '@/store';
import { RemoteDirectoryDialog } from './RemoteDirectoryDialog';
import { SessionImportDialog } from '@/widgets/shell/SessionImportDialog';
import type { ProjectSidebarModel } from './project-sidebar-model';

export function ProjectSidebarRemoteDir(props: { model: ProjectSidebarModel }) {
  const { model } = props;
  return (
    <>
      <RemoteDirectoryDialog
        open={model.remoteBrowseOpen()}
        instanceId={model.projectInstanceId()}
        projects={projects()}
        browsePorts={remoteDirectoryBrowsePorts}
        onClose={() => model.setRemoteBrowseOpen(false)}
        onSelect={(path) => { model.setCwd(path); model.setPickDirectoryError(null); }}
      />
      <Dialog open={model.creating()} onOpenChange={(open) => { if (!open && !model.projectCreateSubmitting()) { model.setCreating(false); model.setPickDirectoryError(null); model.setRemoteBrowseOpen(false); } }}><DialogContent dismissible={!model.projectCreateSubmitting() && !model.pickingDirectory() && !model.remoteBrowseOpen()}><DialogTitle class="sr-only">New project</DialogTitle>
        <form class="m-0 rounded-12 border-0 bg-surface p-18 shadow-none" onSubmit={model.submitProject}>
          <div class="mb-9 flex flex-col gap-6">
            <label class="text-12 font-semibold text-text-secondary" for="project-computer">Computer</label>
            <select
              id="project-computer"
              class="box-border h-34 rounded-9 border border-border-strong bg-surface px-11 text-text-primary outline-none focus:border-focus-ring"
              value={model.projectInstanceId()}
              onChange={(e) => model.setProjectInstanceId(e.currentTarget.value)}
              disabled={model.projectCreateSubmitting()}
            >
              <For each={model.selectableMachines()}>{(machine) => (
                <option value={machine.instanceId} disabled={!isLocalMachine(machine) && !model.machineOnline(machine.instanceId)}>
                  {machine.displayName}{!isLocalMachine(machine) && !model.machineOnline(machine.instanceId) ? ' (offline)' : ''}
                </option>
              )}</For>
            </select>
          </div>
          <div class="mb-9 flex flex-col gap-6">
            <label class="text-12 font-semibold text-text-secondary" for="project-directory">Working directory</label>
            <div class="flex items-center gap-6">
              <input
                id="project-directory"
                class="box-border h-34 min-w-0 flex-1 rounded-9 border border-border-strong bg-surface px-11 text-text-primary outline-none focus:border-focus-ring focus-visible:outline-0"
                value={model.cwd()}
                onInput={(e) => { model.setCwd(e.currentTarget.value); model.setPickDirectoryError(null); }}
                placeholder="/absolute/path"
                autofocus
              />
              <Button type="button" variant="secondary" class="shrink-0" busy={model.pickingDirectory()} disabled={model.projectCreateSubmitting() || (model.isRemoteInstance(model.projectInstanceId()) && !model.machineOnline(model.projectInstanceId()))} onClick={() => { void model.browseProjectDirectory(); }}>
                {model.isRemoteInstance(model.projectInstanceId()) ? 'Browse remote…' : 'Browse…'}
              </Button>
            </div>
            <Show when={model.cwd().trim()}><span class="text-11 text-text-muted">Project name: {projectNameFromPath(model.cwd())}</span></Show>
            <Show when={model.pickDirectoryError()}><span class="m-0 text-13 text-danger">{model.pickDirectoryError()}</span></Show>
          </div>
          <div class="mt-10 flex justify-end gap-6"><Button type="button" disabled={model.projectCreateSubmitting() || model.pickingDirectory()} onClick={() => model.setCreating(false)}>Cancel</Button><Button variant="primary" type="submit" busy={model.projectCreateSubmitting()} disabled={!model.cwd().trim() || model.pickingDirectory()}>Create</Button></div>
        </form>
      </DialogContent></Dialog>

      <SessionImportDialog
        open={!!model.importingProject()}
        project={model.projects().find((item) => item.id === model.importingProject()) || null}
        sessions={model.importableSessions()}
        discovering={model.discoveringSessionsProjectId() === model.importingProject()}
        onDiscover={model.discoverProjectSessions}
        onClose={() => model.setImportingProject(null)}
        onImport={model.importProjectSession}
      />
      <Dialog open={!!model.renamingProject()} onOpenChange={(open) => { if (!open && !model.projectRenameSubmitting()) model.setRenamingProject(null); }}><DialogContent dismissible={!model.projectRenameSubmitting()}><DialogTitle class="sr-only">Rename project</DialogTitle>
        <form class="m-0 rounded-12 border-0 bg-surface p-18 shadow-none" onSubmit={(event) => { event.preventDefault(); const id = model.renamingProject(); if (!id || !model.projectNameDraft().trim()) return; runConfirmedMutation(() => model.setProjectRenameSubmitting(true), () => model.setProjectRenameSubmitting(false), (committed, failed) => model.renameProject(id, model.projectNameDraft(), committed, failed), () => model.setRenamingProject(null)); }}>
          <TextField label="Project name" value={model.projectNameDraft()} onInput={(event) => model.setProjectNameDraft(event.currentTarget.value)} autofocus />
          <p class="mt-2 text-11 leading-15 text-text-muted">Only renames the sidebar entry; the working directory and ACP session are unchanged.</p>
          <div class="mt-10 flex justify-end gap-6"><Button disabled={model.projectRenameSubmitting()} onClick={() => model.setRenamingProject(null)}>Cancel</Button><Button variant="primary" type="submit" busy={model.projectRenameSubmitting()} disabled={!model.projectNameDraft().trim()}>Save</Button></div>
        </form>
      </DialogContent></Dialog>
    </>
  );
}
