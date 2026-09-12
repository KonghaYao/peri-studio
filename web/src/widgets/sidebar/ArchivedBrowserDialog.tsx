import { createEffect, createSignal, Show } from 'solid-js';
import type { ArchivedEntry } from '@/features/catalog/archived-search';
import { searchArchivedEntries } from '@/features/catalog/archived-search';
import { sessionDisplayTitle } from '@/features/session/recovery-state';
import { projectSessions, projects } from '@/store';
import {
  ArchivedBrowserList,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  InlineNotice,
  TextField,
} from '@peri/ui';

export function ArchivedBrowserDialog(props: {
  open: boolean;
  onClose: () => void;
  /** 限定为某 workspace 下已归档会话；省略则显示全部归档项。 */
  projectId?: string | null;
  projectName?: string | null;
  readOnly: boolean;
  restoringProjectId: string | null;
  restoringSessionId: string | null;
  onRestoreProject: (projectId: string) => void;
  onRestoreSession: (sessionId: string) => void;
}) {
  const [query, setQuery] = createSignal('');
  const results = () => searchArchivedEntries(
    query(),
    projects(),
    projectSessions(),
    props.projectId ? { projectId: props.projectId } : undefined,
  );

  createEffect(() => {
    if (!props.open) setQuery('');
  });

  const titleFor = (entry: ArchivedEntry) => entry.kind === 'session'
    ? sessionDisplayTitle(entry.session.title, entry.session.id)
    : entry.title;

  const dialogTitle = () => props.projectName
    ? `${props.projectName} · Archived`
    : 'Archived';

  const listItems = () => results().map((entry) => ({
    id: entry.kind === 'project' ? entry.project.id : entry.session.id,
    title: titleFor(entry),
    subtitle: `${entry.kind === 'project' ? 'Project' : 'Session'} · ${entry.subtitle}`,
  }));

  const restoringId = () => props.restoringProjectId || props.restoringSessionId;

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent size="search" dismissible={!props.restoringProjectId && !props.restoringSessionId}>
        <DialogHeader>
          <DialogTitle>{dialogTitle()}</DialogTitle>
        </DialogHeader>
        <div class="archived-browser-dialog grid gap-10 px-16 pb-16">
          <TextField
            aria-label={props.projectId
              ? 'Search archived sessions'
              : 'Search archived projects and sessions'}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder={props.projectId
              ? 'Search session title or ID'
              : 'Search title, project, directory or ID'}
            autofocus
          />
          <Show
            when={results().length > 0}
            fallback={(
              <EmptyState
                variant="inline"
                class="px-10 py-20"
                title={query().trim() ? 'No matching archived items' : 'Nothing archived yet'}
                description={query().trim()
                  ? 'Try another title or session ID.'
                  : props.projectId
                    ? 'Archived sessions in this workspace will appear here for restore.'
                    : 'Archived projects and sessions will appear here for restore.'}
              />
            )}
          >
            <ArchivedBrowserList
              items={listItems()}
              readOnly={props.readOnly}
              restoringId={restoringId()}
              onRestore={(id) => {
                const entry = results().find((item) => (
                  item.kind === 'project' ? item.project.id === id : item.session.id === id
                ));
                if (!entry) return;
                if (entry.kind === 'project') props.onRestoreProject(entry.project.id);
                else props.onRestoreSession(entry.session.id);
              }}
            />
          </Show>
          <InlineNotice class="m-0 text-11 text-content-muted">
            Restored items return to the sidebar list. Archiving only hides them; nothing is deleted.
          </InlineNotice>
        </div>
      </DialogContent>
    </Dialog>
  );
}
