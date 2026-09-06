import { createEffect, createSignal, For, Show } from 'solid-js';
import { Folder, FolderOpen } from 'lucide-solid';
import type { ProjectInfo } from '@/entities/registry/registry-view';
import {
  installActiveRemoteDirectoryBrowser,
  RemoteDirectoryBrowser,
  type RemoteDirectorySnapshot,
} from '@/features/machine/remote-directory-browse';
import { connectionReady, sendFrame } from '../../panel/lib/connection';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, LoadingState } from '@/shared/ui';

export function RemoteDirectoryDialog(props: {
  open: boolean;
  instanceId: string;
  projects: readonly ProjectInfo[];
  onClose: () => void;
  onSelect: (absolutePath: string) => void;
}) {
  const [snapshot, setSnapshot] = createSignal<RemoteDirectorySnapshot | null>(null);
  let browser: RemoteDirectoryBrowser | null = null;

  const ensureBrowser = () => {
    if (browser) return browser;
    browser = new RemoteDirectoryBrowser({
      ready: connectionReady,
      send: sendFrame,
      subscribe: (docId) => { sendFrame({ t: 'ysync.subscribe', docs: [docId], clientCapabilities: [] }); },
      unsubscribe: (docId) => { sendFrame({ t: 'ysync.unsubscribe', docs: [docId] }); },
    });
    browser.setOnChange(setSnapshot);
    return browser;
  };

  createEffect(() => {
    if (!props.open) {
      installActiveRemoteDirectoryBrowser(null);
      browser?.close();
      browser = null;
      setSnapshot(null);
      return;
    }
    const active = ensureBrowser();
    installActiveRemoteDirectoryBrowser(active);
    active.open(props.instanceId, props.projects);
  });

  const parentRelative = () => {
    const current = snapshot()?.relativePath ?? '';
    if (!current) return null;
    const parts = current.split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent size="search" dismissible>
        <DialogHeader>
          <DialogTitle>Choose folder on remote computer</DialogTitle>
        </DialogHeader>
        <div class="grid gap-10 px-16 pb-16">
          <Show when={snapshot()?.loading && !(snapshot()?.entries.length)}>
            <LoadingState label="Loading remote folders" />
          </Show>
          <Show when={snapshot()?.error}>
            <EmptyState
              variant="inline"
              title="Could not list remote folders"
              description={snapshot()?.error ?? ''}
              action={snapshot()?.retryable ? <Button onClick={() => ensureBrowser().open(props.instanceId, props.projects, snapshot()?.relativePath ?? '')}>Retry</Button> : undefined}
            />
          </Show>
          <Show when={!snapshot()?.error}>
            <div class="flex items-center justify-between gap-8">
              <span class="min-w-0 truncate text-12 text-text-secondary">{snapshot()?.absolutePath || 'Remote path'}</span>
              <Show when={parentRelative() !== null}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => ensureBrowser().openDirectory(parentRelative() ?? '')}
                >
                  Up
                </Button>
              </Show>
            </div>
            <div class="max-h-72 overflow-y-auto rounded-9 border border-border-faint">
              <Show
                when={(snapshot()?.entries.length ?? 0) > 0}
                fallback={<EmptyState variant="inline" class="px-10 py-16" title="No folders here" description="Pick the current path or go up one level." />}
              >
                <ul class="m-0 list-none p-0">
                  <For each={snapshot()?.entries ?? []}>{(entry) => (
                    <li>
                      <button
                        type="button"
                        class="flex w-full min-h-32 items-center gap-8 px-10 py-6 text-left hover:bg-interaction-hover"
                        onClick={() => ensureBrowser().openDirectory(entry.relativePath)}
                      >
                        <Folder size={15} strokeWidth={1.7} class="shrink-0 text-content-muted" />
                        <span class="truncate text-13 text-content-primary">{entry.name}</span>
                      </button>
                    </li>
                  )}</For>
                </ul>
              </Show>
            </div>
            <Show when={snapshot()?.nextCursor}>
              <Button variant="secondary" busy={snapshot()?.loading} onClick={() => ensureBrowser().loadMore()}>Load more</Button>
            </Show>
            <div class="flex justify-end gap-6">
              <Button onClick={props.onClose}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!snapshot()?.absolutePath}
                onClick={() => {
                  const selected = snapshot()?.absolutePath;
                  if (!selected) return;
                  props.onSelect(selected);
                  props.onClose();
                }}
              >
                <FolderOpen size={15} strokeWidth={1.7} />
                Use this folder
              </Button>
            </div>
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
}
