import { For, Show } from 'solid-js';
import { Button, Dialog, DialogContent, DialogTitle, Input, SelectField, TextField } from '@peri/ui';
import { runConfirmedMutation } from '@/features/session/form-mutation';
import { projectNameFromPath } from '@/shared/lib/project-path';
import { isLocalMachine } from '@/entities/machine/machine-view';
import { projects, remoteDirectoryBrowsePorts } from '@/store';
import { RemoteDirectoryDialog } from './RemoteDirectoryDialog';
import { SessionImportDialog } from '@/widgets/shell/SessionImportDialog';
import type { ProjectSidebarModel } from './project-sidebar-model';

export function ProjectSidebarRemoteDir(props: { model: ProjectSidebarModel }) {
  return (
    <>
      <RemoteDirectoryDialog
        open={props.model.remoteBrowseOpen}
        instanceId={props.model.projectInstanceId()}
        projects={projects}
        browsePorts={remoteDirectoryBrowsePorts}
        onClose={() => props.model.setRemoteBrowseOpen(false)}
        onSelect={(path) => { props.model.setCwd(path); props.model.setPickDirectoryError(null); }}
      />
      <Dialog open={props.model.creating()} onOpenChange={(open) => { if (!open && !props.model.projectCreateSubmitting()) { props.model.setCreating(false); props.model.setPickDirectoryError(null); props.model.setRemoteBrowseOpen(false); } }}><DialogContent dismissible={!props.model.projectCreateSubmitting() && !props.model.pickingDirectory() && !props.model.remoteBrowseOpen()}><DialogTitle class="sr-only">New project</DialogTitle>
        <form class="m-0 rounded-12 border-0 bg-surface p-18 shadow-none" onSubmit={props.model.submitProject}>
          <SelectField
            label="Computer"
            id="project-computer"
            value={props.model.projectInstanceId()}
            onChange={(e) => props.model.setProjectInstanceId(e.currentTarget.value)}
            disabled={props.model.projectCreateSubmitting()}
          >
            <For each={props.model.selectableMachines()}>{(machine) => (
              <option value={machine.instanceId} disabled={!isLocalMachine(machine) && !props.model.machineOnline(machine.instanceId)}>
                {machine.displayName}{!isLocalMachine(machine) && !props.model.machineOnline(machine.instanceId) ? ' (offline)' : ''}
              </option>
            )}</For>
          </SelectField>
          <div class="mb-9 flex flex-col gap-6">
            <label class="text-12 font-semibold text-text-secondary" for="project-directory">Working directory</label>
            <div class="flex items-center gap-6">
              <Input
                id="project-directory"
                class="min-w-0 flex-1"
                value={props.model.cwd()}
                onInput={(e) => { props.model.setCwd(e.currentTarget.value); props.model.setPickDirectoryError(null); }}
                placeholder="/absolute/path"
                autofocus
                invalid={!!props.model.pickDirectoryError()}
              />
              <Button type="button" variant="secondary" class="shrink-0" busy={props.model.pickingDirectory()} disabled={props.model.projectCreateSubmitting() || (props.model.isRemoteInstance(props.model.projectInstanceId()) && !props.model.machineOnline(props.model.projectInstanceId()))} onClick={() => { void props.model.browseProjectDirectory(); }}>
                {props.model.isRemoteInstance(props.model.projectInstanceId()) ? 'Browse remote…' : 'Browse…'}
              </Button>
            </div>
            <Show when={props.model.cwd().trim()}><span class="text-11 text-text-muted">Project name: {projectNameFromPath(props.model.cwd())}</span></Show>
            <Show when={props.model.pickDirectoryError()}><span class="m-0 text-13 text-danger">{props.model.pickDirectoryError()}</span></Show>
          </div>
          <div class="mt-10 flex justify-end gap-6"><Button type="button" disabled={props.model.projectCreateSubmitting() || props.model.pickingDirectory()} onClick={() => props.model.setCreating(false)}>Cancel</Button><Button variant="primary" type="submit" busy={props.model.projectCreateSubmitting()} disabled={!props.model.cwd().trim() || props.model.pickingDirectory()}>Create</Button></div>
        </form>
      </DialogContent></Dialog>

      <SessionImportDialog
        open={!!props.model.importingProject()}
        project={props.model.projects().find((item) => item.id === props.model.importingProject()) || null}
        sessions={props.model.importableSessions()}
        discovering={props.model.discoveringSessionsProjectId() === props.model.importingProject()}
        onDiscover={props.model.discoverProjectSessions}
        onClose={() => props.model.setImportingProject(null)}
        onImport={props.model.importProjectSession}
      />
      <Dialog open={!!props.model.renamingProject()} onOpenChange={(open) => { if (!open && !props.model.projectRenameSubmitting()) props.model.setRenamingProject(null); }}><DialogContent dismissible={!props.model.projectRenameSubmitting()}><DialogTitle class="sr-only">Rename project</DialogTitle>
        <form class="m-0 rounded-12 border-0 bg-surface p-18 shadow-none" onSubmit={(event) => { event.preventDefault(); const id = props.model.renamingProject(); if (!id || !props.model.projectNameDraft().trim()) return; runConfirmedMutation(() => props.model.setProjectRenameSubmitting(true), () => props.model.setProjectRenameSubmitting(false), (committed, failed) => props.model.renameProject(id, props.model.projectNameDraft(), committed, failed), () => props.model.setRenamingProject(null)); }}>
          <TextField label="Project name" value={props.model.projectNameDraft()} onInput={(event) => props.model.setProjectNameDraft(event.currentTarget.value)} autofocus />
          <p class="mt-2 text-11 leading-15 text-text-muted">Only renames the sidebar entry; the working directory and ACP session are unchanged.</p>
          <div class="mt-10 flex justify-end gap-6"><Button disabled={props.model.projectRenameSubmitting()} onClick={() => props.model.setRenamingProject(null)}>Cancel</Button><Button variant="primary" type="submit" busy={props.model.projectRenameSubmitting()} disabled={!props.model.projectNameDraft().trim()}>Save</Button></div>
        </form>
      </DialogContent></Dialog>
    </>
  );
}
