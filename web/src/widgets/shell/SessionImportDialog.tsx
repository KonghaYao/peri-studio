import { createEffect, createMemo, createSignal, Show, untrack } from 'solid-js';
import type { ProjectInfo, SessionSummaryInfo } from '@/entities/registry/registry-view';
import { Button, Dialog, DialogContent, DialogTitle, EmptyState, InlineNotice, Listbox, ListboxItem, ListboxItemDescription, ListboxItemLabel, LoadingState, TextField } from '../../components/ui';
import { MessageSquare } from 'lucide-solid';
import { importCandidates } from '../../features/session/session-import.ts';
import { cleanSessionTitle, formatRelativeTime, shortSessionId } from '../../panel/lib/recovery-state.ts';

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
  return <MessageSquare size={18} strokeWidth={1.7} />;
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
    <div class="p-20">
      <div>
        <span class="block mb-5 text-text-muted text-10 font-bold tracking-8 uppercase">{props.project?.name}</span>
        <h2 class="m-0 text-18 tracking-[-.02em]">Import session</h2>
        <p class="mt-6 mb-16 text-13 leading-145 text-text-secondary">Shows only ACP sessions in this project directory that are not yet in the sidebar. Importing does not copy or move the original session.</p>
      </div>
      <TextField class="mb-12" label="Search sessions" value={query()} disabled={submitting() || props.discovering} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search by title or session ID" />
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
          renderItem={(item) => <ListboxItem item={item} class="grid w-full min-h-54 grid-cols-import items-center gap-10 rounded-10 border border-transparent bg-transparent px-10 py-9 text-left cursor-pointer hover:bg-hover data-[selected]:border-border-strong data-[selected]:bg-selected">
            <ChatIcon />
            <span class="flex min-w-0 flex-col gap-3"><ListboxItemLabel as="strong" class="overflow-hidden text-ellipsis whitespace-nowrap text-13">{cleanSessionTitle(item.rawValue.title)}</ListboxItemLabel><ListboxItemDescription as="small" class="text-11 text-text-secondary">{formatRelativeTime(item.rawValue.updatedAt)} · ID …{shortSessionId(item.rawValue.sessionId)}</ListboxItemDescription></span>
            <Show when={selectedId() === item.rawValue.sessionId}><span class="grid place-items-center w-18 h-18 rounded-full bg-btn-primary text-surface text-11" aria-hidden="true">✓</span></Show>
          </ListboxItem>}
        />
      </Show>}>
        <LoadingState class="import-empty px-12 py-28" label="Reading ACP sessions" />
      </Show>
      <Show when={selected()}>{(candidate) => <section id="import-session-review" class="mt-12 rounded-12 border border-border-subtle bg-surface-muted p-12" role="region" aria-label="Pending import details">
        <header class="flex flex-col gap-2"><span class="text-10 font-bold tracking-6 uppercase text-text-secondary">Review before import</span><strong class="text-14">{cleanSessionTitle(candidate().title)}</strong></header>
        <dl class="grid gap-6 my-10">
          <div class="grid grid-cols-[88px_minmax(0,1fr)] gap-8"><dt class="text-11 text-text-secondary">Project directory</dt><dd class="min-w-0 m-0 wrap-anywhere text-11 text-text-primary"><code class="font-mono text-11 leading-145">{props.project?.cwd}</code></dd></div>
          <div class="grid grid-cols-[88px_minmax(0,1fr)] gap-8"><dt class="text-11 text-text-secondary">Recent activity</dt><dd class="min-w-0 m-0 wrap-anywhere text-11 text-text-primary">{formatRelativeTime(candidate().updatedAt)}</dd></div>
          <div class="grid grid-cols-[88px_minmax(0,1fr)] gap-8"><dt class="text-11 text-text-secondary">Full ACP ID</dt><dd class="min-w-0 m-0 wrap-anywhere text-11 text-text-primary"><code class="font-mono text-11 leading-145">{candidate().sessionId}</code></dd></div>
        </dl>
        <p class="mt-9 mb-0 border-t border-divider pt-9 text-11 leading-15 text-text-secondary">ACP does not provide a message preview. Confirm via the project directory, title, time and full ID; importing only adds this session to the sidebar, without copying or moving content.</p>
      </section>}</Show>
      <Show when={submitting()}><LoadingState class="import-session-status mt-10 px-10 py-9" label="Confirming the import result with the server" /></Show>
      <Show when={problem()}>{(message) => <InlineNotice class="import-session-problem mt-10" tone="danger">{message()}</InlineNotice>}</Show>
      <Show when={!props.discovering && problem()}><Button size="compact" onClick={() => { const id = props.project?.id; if (id) props.onDiscover(id, () => setProblem(null), setProblem); }}>Refresh ACP sessions</Button></Show>
      <div class="mt-10 flex justify-end gap-6">
        <Button disabled={submitting()} onClick={close}>Cancel</Button>
        <Button variant="primary" busy={submitting()} disabled={!selected() || props.discovering} onClick={submit}>Import selected session</Button>
      </div>
    </div>
  </DialogContent></Dialog>;
}
