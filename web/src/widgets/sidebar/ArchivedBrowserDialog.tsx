import { createEffect, createSignal, For, Show } from 'solid-js';
import type { ArchivedEntry } from '@/features/catalog/archived-search';
import { searchArchivedEntries } from '@/features/catalog/archived-search';
import { sessionDisplayTitle } from '@/features/session/recovery-state';
import { projectSessions, projects } from '@/store';
import {
  Button,
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
            <ul class="archived-browser-list ui-scrollbar m-0 grid max-h-(--container-search-results) list-none gap-1 overflow-auto p-0" aria-label="Archived items">
              <For each={results()}>
                {(entry) => (
                  <li class="archived-browser-row flex min-h-32 items-center gap-8 rounded-md px-10 py-6 hover:bg-interaction-hover pointer-coarse:min-h-44">
                    <span class="grid min-w-0 flex-1 gap-1">
                      <strong class="overflow-hidden text-ellipsis whitespace-nowrap text-13 font-normal text-content-primary">
                        {titleFor(entry)}
                      </strong>
                      <small class="overflow-hidden text-ellipsis whitespace-nowrap text-11 text-content-muted">
                        {entry.kind === 'project' ? 'Project' : 'Session'} · {entry.subtitle}
                      </small>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-24! shrink-0 px-8! text-11! pointer-coarse:min-h-44!"
                      busy={entry.kind === 'project'
                        ? props.restoringProjectId === entry.project.id
                        : props.restoringSessionId === entry.session.id}
                      disabled={props.readOnly
                        || !!props.restoringProjectId
                        || !!props.restoringSessionId}
                      onClick={() => {
                        if (entry.kind === 'project') props.onRestoreProject(entry.project.id);
                        else props.onRestoreSession(entry.session.id);
                      }}
                    >
                      Restore
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <InlineNotice class="m-0 text-11 text-content-muted">
            Restored items return to the sidebar list. Archiving only hides them; nothing is deleted.
          </InlineNotice>
        </div>
      </DialogContent>
    </Dialog>
  );
}
