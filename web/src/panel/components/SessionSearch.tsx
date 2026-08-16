import { createEffect, createSignal, For, Show } from 'solid-js';
import { Dialog, primaryShortcut, Spinner, TextField } from '../../ui';
import { navigateProjectSession, openingSessionId, projectSessions, projects, selectedSessionId } from '../store';
import { readOnly } from '../lib/auth-state';
import { formatRelativeTime, sessionDisplayTitle, shortSessionId } from '../lib/recovery-state.ts';
import { searchProjectSessions } from '../lib/session-search.ts';
import type { ProjectSessionInfo } from '../lib/registry-view';

type SearchResult = ProjectSessionInfo & { project: { name: string } | null };

export function SessionSearch(props: { open: boolean; onClose: () => void; onSelected?: () => void }) {
  const [query, setQuery] = createSignal('');
  const [problem, setProblem] = createSignal<string | null>(null);
  let resultList: HTMLDivElement | undefined;
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
  const focusResult = (direction: 1 | -1) => {
    const items = [...(resultList?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0 ? (direction > 0 ? 0 : items.length - 1) : (current + direction + items.length) % items.length;
    items[next]?.focus();
  };
  return <Dialog open={props.open} title="Search sessions" showHeader dismissible={!openingSessionId()} onClose={props.onClose}>
    <div class="session-search-dialog grid gap-14 min-w-(--container-search) px-18 pb-18">
      <TextField aria-label="Search sessions" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); focusResult(1); } }} placeholder="Search title, project, directory or session ID" autofocus />
      <div ref={resultList} class="session-search-results grid max-h-(--container-search-results) gap-4 overflow-auto" role="listbox" aria-label="Search results" onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusResult(event.key === 'ArrowDown' ? 1 : -1); } }}>
        <Show when={query().trim()} fallback={<div class="session-search-hint px-12 py-28 text-center text-12 text-text-muted"><kbd>{primaryShortcut('K')}</kbd> opens search anytime. Start typing a project name or session title.</div>}>
          <For each={results()} fallback={<div class="session-search-hint px-12 py-28 text-center text-12 text-text-muted">No matching saved sessions</div>}>{(session) =>
            <button type="button" role="option" aria-selected={selectedSessionId() === session.id} disabled={(readOnly() && !session.activeChatId) || session.lifecycle !== 'ready' || !!openingSessionId()} onClick={() => choose(session)} class="flex w-full cursor-pointer items-center justify-between gap-18 rounded-9 border-0 bg-transparent px-12 py-10 text-left text-text-primary hover:bg-hover focus-visible:bg-hover disabled:cursor-not-allowed disabled:opacity-52 pointer-coarse:min-h-44">
              <span class="grid min-w-0 gap-3"><strong class="overflow-hidden text-ellipsis whitespace-nowrap">{sessionDisplayTitle(session.title, session.acpSessionId || session.id)}</strong><small class="overflow-hidden text-ellipsis whitespace-nowrap text-12 text-text-muted">{session.project?.name || 'Unknown project'} · {formatRelativeTime(session.lastOpenedAt || session.updatedAt)}</small></span>
              <Show when={openingSessionId() === session.id} fallback={<code class="flex-none text-12 text-text-muted">…{shortSessionId(session.acpSessionId || session.id)}</code>}><Spinner label="Opening" /></Show>
            </button>
          }</For>
        </Show>
      </div>
      <Show when={problem()}>{(message) => <p class="session-search-problem m-0 rounded-9 border border-warning-border bg-warning-soft px-10 py-9 text-12 leading-145 text-warning" role="alert">{message()}</p>}</Show>
    </div>
  </Dialog>;
}
