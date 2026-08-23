import { Show, createMemo } from 'solid-js';
import { Icon } from '../../components/ui';
import { connState } from '../lib/connection';
import { readOnly } from '../lib/auth-state';
import { globalStatus, projectSessions, projects, resourceWorkspace, selectedSessionId } from '../store';

function FilesIcon() {
  return <Icon size="small"><path d="M4 3h8l4 4v10H4z" /><path d="M12 3v4h4M7 10h6M7 13h6" /></Icon>;
}

export function WorkbenchStatusBar(props: { onOpenResources: () => void }) {
  const project = createMemo(() => {
    const session = projectSessions().find((item) => item.id === selectedSessionId());
    return projects().find((item) => item.id === session?.projectId) ?? null;
  });
  const repository = () => resourceWorkspace().repositories[0];
  const changes = () => resourceWorkspace().repositories.reduce(
    (sum, repo) => sum + Object.values(repo.groups).reduce((count, group) => count + group.count, 0),
    0,
  );
  const connectionLabel = () => connState().kind === 'ok'
    ? 'Online'
    : connState().kind === 'warn' ? 'Reconnecting' : connState().kind === 'err' ? 'Offline' : 'Connecting';

  return <footer class="workbench-status-bar col-[1/-1] row-start-2 flex h-22 min-w-0 items-center gap-12 bg-accent px-8 text-11 text-white pointer-coarse:h-44" aria-label="Workbench status">
    <span class="flex min-w-0 items-center gap-5" title={connState().text}>
      <i aria-hidden="true" class={`size-6 shrink-0 rounded-full ${connState().kind === 'ok' ? 'bg-success' : connState().kind === 'warn' ? 'bg-warning' : 'bg-danger'}`} />
      <span class="max-narrow:sr-only">{connectionLabel()}</span>
    </span>
    <Show when={project()}>{(current) => <span class="min-w-0 max-w-180 overflow-hidden text-ellipsis whitespace-nowrap">{current().name}</span>}</Show>
    <button type="button" class="ml-auto flex h-full min-w-0 items-center gap-5 border-0 bg-transparent px-6 text-inherit hover:bg-white/10 focus-visible:outline-white pointer-coarse:min-h-44 pointer-coarse:px-10" aria-label="Open workspace resources" onClick={props.onOpenResources}>
      <FilesIcon />
      <Show when={repository()} fallback={<span>Files</span>}>
        <span class="max-w-180 overflow-hidden text-ellipsis whitespace-nowrap">{repository()?.headName || 'Git'}</span>
      </Show>
      <Show when={changes() > 0}><span class="tabular-nums">{changes()}</span></Show>
    </button>
    <Show when={readOnly()}><span title="This session cannot mutate workspace or Git state">Read-only</span></Show>
    <span class="uppercase tracking-4 max-narrow:hidden" title={`Server state: ${globalStatus()}`}>{globalStatus()}</span>
  </footer>;
}
