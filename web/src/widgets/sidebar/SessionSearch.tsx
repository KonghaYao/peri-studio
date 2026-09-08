import { primaryShortcut } from '@/shared/lib/keyboard';
import { createEffect, createSignal, Show } from 'solid-js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, InlineNotice, Listbox, ListboxItem, ListboxItemDescription, ListboxItemLabel, Spinner, TextField } from '@/shared/ui';
import { navigateProjectSession, openingSessionId, projectSessions, projects, selectedSessionId } from '../../panel/store';
import { readOnly } from '../../panel/lib/auth-state';
import { formatRelativeTime, sessionDisplayTitle, shortSessionId } from '../../panel/lib/recovery-state.ts';
import { searchProjectSessions } from '../../features/session/session-search.ts';
import type { ProjectSessionInfo } from '@/entities/registry/registry-view';

type SearchResult = ProjectSessionInfo & { project: { name: string } | null };

export function SessionSearch(props: { open: boolean; onClose: () => void; onSelected?: () => void }) {
  const [query, setQuery] = createSignal('');
  const [problem, setProblem] = createSignal<string | null>(null);
  let resultList: HTMLUListElement | undefined;
  const results = () => searchProjectSessions(
    query(),
    projects().filter((project) => !project.archivedAt),
    projectSessions().filter((session) => !session.archivedAt),
  ) as SearchResult[];
  createEffect(() => { if (!props.open) { setQuery(''); setProblem(null); } });
  const choose = (session: ProjectSessionInfo) => {
    setProblem(null);
    navigateProjectSession(session.id, {
      onCommitted: () => { props.onClose(); props.onSelected?.(); },
      onFailed: (message) => setProblem(message),
      onUncertain: () => setProblem('Opening is not confirmed yet. The current session was not switched; wait for the state to sync before deciding whether to retry.'),
    });
  };
  const select = (values: Set<string>) => {
    const id = values.values().next().value as string | undefined;
    const session = results().find((item) => item.id === id);
    if (session) choose(session);
  };
  const focusResults = () => { if (results().length) resultList?.focus(); };

  return <Dialog open={props.open} onOpenChange={(open) => { if (!open && !openingSessionId()) props.onClose(); }}><DialogContent size="search" dismissible={!openingSessionId()}><DialogHeader><DialogTitle>Search sessions</DialogTitle></DialogHeader>
    <div class="session-search-dialog grid gap-10 px-16 pb-16">
      <TextField aria-label="Search sessions" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); focusResults(); } }} placeholder="Search title, project, directory or session ID" autofocus />
      <Show when={query().trim()} fallback={<InlineNotice class="session-search-hint px-10 py-20 text-center text-12 text-text-muted"><kbd>{primaryShortcut('K')}</kbd> opens search anytime. Start typing a project name or session title.</InlineNotice>}>
        <Show when={results().length} fallback={<EmptyState variant="inline" class="session-search-hint px-10 py-20" title="No matching saved sessions" description="Try another title, project, directory, or session ID." />}>
          <Listbox
            ref={resultList}
            class="ui-listbox session-search-results grid max-h-(--container-search-results) gap-1 overflow-auto"
            aria-label="Search results"
            options={results()}
            optionValue="id"
            optionTextValue={(session) => sessionDisplayTitle(session.title, session.id)}
            optionDisabled={(session) => (readOnly() && !session.activeChatId) || session.lifecycle !== 'ready' || !!openingSessionId()}
            value={selectedSessionId() ? [selectedSessionId()!] : []}
            onChange={select}
            shouldFocusWrap
            renderItem={(item) => <ListboxItem item={item} recipe="search">
              <span class="grid min-w-0 gap-1"><ListboxItemLabel as="strong" class="overflow-hidden text-ellipsis whitespace-nowrap text-13 font-normal">{sessionDisplayTitle(item.rawValue.title, item.rawValue.id)}</ListboxItemLabel><ListboxItemDescription as="small" class="overflow-hidden text-ellipsis whitespace-nowrap text-11 text-content-muted">{item.rawValue.project?.name || 'Unknown project'} · {formatRelativeTime(item.rawValue.lastOpenedAt || item.rawValue.updatedAt)}</ListboxItemDescription></span>
              <Show when={openingSessionId() === item.rawValue.id} fallback={<code class="flex-none text-11 text-content-muted">…{shortSessionId(item.rawValue.id)}</code>}><Spinner label="Opening" /></Show>
            </ListboxItem>}
          />
        </Show>
      </Show>
      <Show when={problem()}>{(message) => <InlineNotice class="session-search-problem m-0" tone="warning" role="alert">{message()}</InlineNotice>}</Show>
    </div>
  </DialogContent></Dialog>;
}
