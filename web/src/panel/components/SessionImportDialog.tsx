import { createEffect, createMemo, createSignal, Show, untrack } from 'solid-js';
import type { ProjectInfo, SessionSummaryInfo } from '../lib/registry-view';
import { Button, Dialog, DialogContent, DialogTitle, EmptyState, Icon, InlineNotice, Listbox, ListboxItem, ListboxItemDescription, ListboxItemLabel, LoadingState, TextField } from '../../components/ui';
import { importCandidates } from '../lib/session-import.ts';
import { cleanSessionTitle, formatRelativeTime, shortSessionId } from '../lib/recovery-state.ts';

export interface SessionImportDialogProps {
  open: boolean;
  project: ProjectInfo | null;
  sessions: SessionSummaryInfo[];
  onClose: () => void;
  discovering: boolean;
  onDiscover: (projectId: string, onCommitted: () => void, onFailed: (message: string) => void) => boolean;
  onImport: (
    projectId: string,
    sessionId: string,
    onCommitted: () => void,
    onFailed: (kind: 'failed' | 'uncertain') => void,
  ) => boolean;
}

function ChatIcon() {
  return <Icon><path d="M4 4.5h12v9H8l-4 3v-12Z" /></Icon>;
}

export function SessionImportDialog(props: SessionImportDialogProps) {
  const [query, setQuery] = createSignal('');
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.open) return;
    props.project?.id;
    setQuery('');
    setSelectedId(null);
    setSubmitting(false);
    setProblem(null);
    const projectId = props.project?.id;
    if (projectId) untrack(() => props.onDiscover(projectId, () => setProblem(null), setProblem));
  });

  const candidates = createMemo(() => {
    const all = importCandidates(props.sessions, props.project?.cwd || '');
    const needle = query().trim().toLocaleLowerCase();
    if (!needle) return all;
    return all.filter((candidate) => (
      cleanSessionTitle(candidate.title).toLocaleLowerCase().includes(needle)
      || candidate.sessionId.toLocaleLowerCase().includes(needle)
    ));
  });
  const selected = createMemo(() => candidates().find((candidate) => candidate.sessionId === selectedId()) || null);

  const close = () => {
    if (!submitting()) props.onClose();
  };

  const submit = () => {
    const projectId = props.project?.id;
    const sessionId = selected()?.sessionId;
    if (!projectId || !sessionId || submitting()) return;
    setSubmitting(true);
    setProblem(null);
    const sent = props.onImport(projectId, sessionId, () => {
      setSubmitting(false);
      props.onClose();
    }, (kind) => {
      setSubmitting(false);
      setProblem(kind === 'uncertain'
        ? 'The import result is not confirmed yet. Your selection is kept; wait for the sidebar to sync or re-confirm via the original request in the error center. Do not create a duplicate request.'
        : 'The server rejected this import. Your selection is kept; check the error center for the reason and resubmit after fixing it.');
    });
    if (!sent) {
      setSubmitting(false);
      setProblem('The import request was not sent. Your selection is kept; check the connection and try again.');
    }
  };

  const selectCandidate = (values: Set<string>) => {
    const sessionId = values.values().next().value as string | undefined;
    if (!sessionId) return;
    setSelectedId(sessionId);
    setProblem(null);
  };

  return <Dialog open={props.open} onOpenChange={(open) => { if (!open && !submitting()) close(); }}><DialogContent dismissible={!submitting()}><DialogTitle class="sr-only">Import ACP session</DialogTitle>
    <div class="import-dialog p-20">
      <div class="import-dialog__header">
        <span class="dialog-eyebrow block mb-5 text-text-muted text-10 font-bold tracking-8 uppercase">{props.project?.name}</span>
        <h2>Import session</h2>
        <p>Shows only ACP sessions in this project directory that are not yet in the sidebar. Importing does not copy or move the original session.</p>
      </div>
      <TextField label="Search sessions" value={query()} disabled={submitting() || props.discovering} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search by title or session ID" />
      <Show when={props.discovering} fallback={<Show when={candidates().length} fallback={<EmptyState variant="inline" class="import-empty px-12 py-28" title="No sessions to import" description="No matching ACP sessions are available for this project directory." />}>
        <Listbox
          class="ui-listbox import-session-list flex max-h-300 flex-col gap-4 overflow-auto"
          aria-label="Importable ACP sessions"
          options={candidates()}
          optionValue="sessionId"
          optionTextValue={(candidate) => cleanSessionTitle(candidate.title)}
          optionDisabled={() => submitting() || props.discovering}
          value={selectedId() ? [selectedId()!] : []}
          onChange={selectCandidate}
          shouldFocusWrap
          renderItem={(item) => <ListboxItem item={item} class="import-session-row grid grid-cols-import items-center gap-10 w-full min-h-54 px-10 py-9 border border-transparent rounded-10 bg-transparent text-left cursor-pointer hover:bg-hover">
            <ChatIcon />
            <span><ListboxItemLabel as="strong">{cleanSessionTitle(item.rawValue.title)}</ListboxItemLabel><ListboxItemDescription as="small">{formatRelativeTime(item.rawValue.updatedAt)} · ID …{shortSessionId(item.rawValue.sessionId)}</ListboxItemDescription></span>
            <Show when={selectedId() === item.rawValue.sessionId}><span class="import-session-check !grid place-items-center w-18 h-18 rounded-full bg-btn-primary text-surface text-11" aria-hidden="true">✓</span></Show>
          </ListboxItem>}
        />
      </Show>}>
        <LoadingState class="import-empty px-12 py-28" label="Reading ACP sessions" />
      </Show>
      <Show when={selected()}>{(candidate) => <section id="import-session-review" class="import-session-review mt-12 p-12 border border-border-subtle rounded-12 bg-surface-muted" role="region" aria-label="Pending import details">
        <header><span>Review before import</span><strong>{cleanSessionTitle(candidate().title)}</strong></header>
        <dl>
          <div><dt>Project directory</dt><dd><code>{props.project?.cwd}</code></dd></div>
          <div><dt>Recent activity</dt><dd>{formatRelativeTime(candidate().updatedAt)}</dd></div>
          <div><dt>Full ACP ID</dt><dd><code>{candidate().sessionId}</code></dd></div>
        </dl>
        <p>ACP does not provide a message preview. Confirm via the project directory, title, time and full ID; importing only adds this session to the sidebar, without copying or moving content.</p>
      </section>}</Show>
      <Show when={submitting()}><LoadingState class="import-session-status mt-10 px-10 py-9" label="Confirming the import result with the server" /></Show>
      <Show when={problem()}>{(message) => <InlineNotice class="import-session-problem mt-10" tone="danger">{message()}</InlineNotice>}</Show>
      <Show when={!props.discovering && problem()}><Button size="compact" onClick={() => { const id = props.project?.id; if (id) props.onDiscover(id, () => setProblem(null), setProblem); }}>Refresh ACP sessions</Button></Show>
      <div class="form-actions flex justify-end gap-6 mt-10">
        <Button disabled={submitting()} onClick={close}>Cancel</Button>
        <Button variant="primary" busy={submitting()} disabled={!selected() || props.discovering} onClick={submit}>Import selected session</Button>
      </div>
    </div>
  </DialogContent></Dialog>;
}
