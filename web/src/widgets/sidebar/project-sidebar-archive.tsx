import { runConfirmedMutation } from '@/features/session/form-mutation';
import { sessionDisplayTitle } from '@/features/session/recovery-state';
import { ArchivedBrowserDialog } from './ArchivedBrowserDialog';
import { ConfirmDialog } from '@/widgets/shell/shared/ConfirmDialog';
import type { ProjectSidebarModel } from './project-sidebar-model';

export function ProjectSidebarArchive(props: { model: ProjectSidebarModel }) {
  const { model } = props;
  return (
    <>
      <ArchivedBrowserDialog
        open={model.archivedBrowserGlobalOpen() || model.archivedBrowserProjectId() !== null}
        onClose={() => {
          model.setArchivedBrowserGlobalOpen(false);
          model.setArchivedBrowserProjectId(null);
        }}
        projectId={model.archivedBrowserProjectId()}
        projectName={model.archivedBrowserProject()?.name ?? null}
        readOnly={model.readOnly()}
        restoringProjectId={model.restoringProject()}
        restoringSessionId={model.sessionLifecycleBusy()}
        onRestoreProject={(projectId) => runConfirmedMutation(
          () => model.setRestoringProject(projectId),
          () => model.setRestoringProject(null),
          (committed, failed) => model.restoreProject(projectId, committed, failed),
          () => {},
        )}
        onRestoreSession={(sessionId) => runConfirmedMutation(
          () => model.setSessionLifecycleBusy(sessionId),
          () => model.setSessionLifecycleBusy(null),
          (committed, failed) => model.restoreProjectSession(sessionId, committed, failed),
          () => {},
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
      {(() => {
        const session = () => model.projectSessions().find((item) => item.id === model.archiveSessionCandidate());
        const displayTitle = () => sessionDisplayTitle(session()?.title, session()?.id);
        return <ConfirmDialog
          open={!!model.archiveSessionCandidate()}
          onOpenChange={(open) => { if (!open && !model.sessionLifecycleBusy()) model.setArchiveSessionCandidate(null); }}
          eyebrow="Session cleanup"
          title={`Archive “${displayTitle()}”?`}
          description="The session will be hidden from the current project list, but the ACP thread, message history, and local project files are not deleted. You can restore it later from the workspace More menu → Archived."
          cancelDisabled={!!model.sessionLifecycleBusy()}
          confirmLabel="Archive session"
          confirmBusy={!!model.sessionLifecycleBusy()}
          onCancel={() => model.setArchiveSessionCandidate(null)}
          onConfirm={() => { const id = model.archiveSessionCandidate(); if (!id) return; runConfirmedMutation(() => model.setSessionLifecycleBusy(id), () => model.setSessionLifecycleBusy(null), (committed, failed) => model.archiveProjectSession(id, committed, failed), () => model.setArchiveSessionCandidate(null)); }}
        />;
      })()}
    </>
  );
}
