import { runConfirmedMutation } from '@/features/session/form-mutation';
import { ArchivedBrowserDialog } from './ArchivedBrowserDialog';
import { ConfirmDialog } from '@/widgets/shell/shared/ConfirmDialog';
import type { ProjectSidebarModel } from './project-sidebar-model';

export function ProjectSidebarArchive(props: { model: ProjectSidebarModel }) {
  const closeArchivedBrowser = () => {
    props.model.setArchivedBrowserGlobalOpen(false);
    props.model.setArchivedBrowserProjectId(null);
  };
  return (
    <>
      <ArchivedBrowserDialog
        open={() => props.model.archivedBrowserGlobalOpen() || props.model.archivedBrowserProjectId() !== null}
        onClose={closeArchivedBrowser}
        projectId={props.model.archivedBrowserProjectId}
        projectName={() => props.model.archivedBrowserProject()?.name ?? null}
        readOnly={props.model.readOnly}
        restoringId={() => props.model.restoringProject() || props.model.sessionLifecycleBusy()}
        onRestoreProject={(projectId) => runConfirmedMutation(
          () => props.model.setRestoringProject(projectId),
          () => props.model.setRestoringProject(null),
          (committed, failed) => props.model.restoreProject(projectId, committed, failed),
          closeArchivedBrowser,
        )}
        onRestoreSession={(sessionId) => runConfirmedMutation(
          () => props.model.setSessionLifecycleBusy(sessionId),
          () => props.model.setSessionLifecycleBusy(null),
          (committed, failed) => props.model.restoreProjectSession(sessionId, committed, failed),
          closeArchivedBrowser,
        )}
      />
      {(() => {
        const project = () => props.model.projects().find((item) => item.id === props.model.archiveCandidate());
        const count = () => props.model.projectSessions().filter((session) => session.projectId === props.model.archiveCandidate()).length;
        const running = () => !!props.model.archiveCandidate() && props.model.projectHasRunningSession(props.model.archiveCandidate()!);
        return <ConfirmDialog
          open={!!props.model.archiveCandidate()}
          onOpenChange={(open) => { if (!open && !props.model.archiveSubmitting()) props.model.setArchiveCandidate(null); }}
          eyebrow="Project management"
          title={`Archive “${project()?.name}”?`}
          description={<>The project will be hidden from the sidebar; its {count()} saved sessions will not be deleted. No files in the working directory are touched.</>}
          warning={running() ? 'This project still has running instances. Close the running instances from each session menu before archiving.' : undefined}
          cancelDisabled={props.model.archiveSubmitting()}
          confirmLabel="Archive project"
          confirmDisabled={running()}
          confirmBusy={props.model.archiveSubmitting()}
          onCancel={() => props.model.setArchiveCandidate(null)}
          onConfirm={() => { const id = props.model.archiveCandidate(); if (!id) return; runConfirmedMutation(() => props.model.setArchiveSubmitting(true), () => props.model.setArchiveSubmitting(false), (committed, failed) => props.model.archiveProject(id, committed, failed), () => props.model.setArchiveCandidate(null)); }}
        />;
      })()}
    </>
  );
}
