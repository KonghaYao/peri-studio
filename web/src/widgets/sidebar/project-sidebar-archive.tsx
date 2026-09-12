import { runConfirmedMutation } from '@/features/session/form-mutation';
import { ArchivedBrowserDialog } from './ArchivedBrowserDialog';
import { ConfirmDialog } from '@/widgets/shell/shared/ConfirmDialog';
import type { ProjectSidebarModel } from './project-sidebar-model';

export function ProjectSidebarArchive(props: { model: ProjectSidebarModel }) {
  const { model } = props;
  const closeArchivedBrowser = () => {
    model.setArchivedBrowserGlobalOpen(false);
    model.setArchivedBrowserProjectId(null);
  };
  return (
    <>
      <ArchivedBrowserDialog
        open={model.archivedBrowserGlobalOpen() || model.archivedBrowserProjectId() !== null}
        onClose={closeArchivedBrowser}
        projectId={model.archivedBrowserProjectId()}
        projectName={model.archivedBrowserProject()?.name ?? null}
        readOnly={model.readOnly()}
        restoringProjectId={model.restoringProject()}
        restoringSessionId={model.sessionLifecycleBusy()}
        onRestoreProject={(projectId) => runConfirmedMutation(
          () => model.setRestoringProject(projectId),
          () => model.setRestoringProject(null),
          (committed, failed) => model.restoreProject(projectId, committed, failed),
          closeArchivedBrowser,
        )}
        onRestoreSession={(sessionId) => runConfirmedMutation(
          () => model.setSessionLifecycleBusy(sessionId),
          () => model.setSessionLifecycleBusy(null),
          (committed, failed) => model.restoreProjectSession(sessionId, committed, failed),
          closeArchivedBrowser,
        )}
      />
      {(() => {
        const project = () => model.projects().find((item) => item.id === model.archiveCandidate());
        const count = () => model.projectSessions().filter((session) => session.projectId === model.archiveCandidate()).length;
        const running = () => !!model.archiveCandidate() && model.projectHasRunningSession(model.archiveCandidate()!);
        return <ConfirmDialog
          open={!!model.archiveCandidate()}
          onOpenChange={(open) => { if (!open && !model.archiveSubmitting()) model.setArchiveCandidate(null); }}
          eyebrow="Project management"
          title={`Archive “${project()?.name}”?`}
          description={<>The project will be hidden from the sidebar; its {count()} saved sessions will not be deleted. No files in the working directory are touched.</>}
          warning={running() ? 'This project still has running instances. Close the running instances from each session menu before archiving.' : undefined}
          cancelDisabled={model.archiveSubmitting()}
          confirmLabel="Archive project"
          confirmDisabled={running()}
          confirmBusy={model.archiveSubmitting()}
          onCancel={() => model.setArchiveCandidate(null)}
          onConfirm={() => { const id = model.archiveCandidate(); if (!id) return; runConfirmedMutation(() => model.setArchiveSubmitting(true), () => model.setArchiveSubmitting(false), (committed, failed) => model.archiveProject(id, committed, failed), () => model.setArchiveCandidate(null)); }}
        />;
      })()}
    </>
  );
}
