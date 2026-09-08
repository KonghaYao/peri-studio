import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { promptMaxBytes } from '@/features/connection/connection';
import { applyFileReferenceWithBudget, draftContainsReferenceToken } from '@/features/composer/composer-file-reference';
import {
  enqueueComposerRootUpload,
  enqueueQuickStartRootUpload,
  markWorkspaceUploadReferenceInjected,
  retryWorkspaceUpload,
  workspaceUploadAvailable,
  workspaceUploadBatch,
  workspaceUploadBlockedMessage,
  workspaceUploadLiveMessage,
  workspaceUploadOrigin,
  workspaceUploadProgressPercent,
  workspaceUploadTileStatus,
  type WorkspaceUploadOrigin,
} from '@/store';
import { ComposerDropOverlay } from './ComposerDropOverlay';
import { UploadAssetTile } from './UploadAssetTile';
import { dataTransferHasFiles, parseFileDropTransfer, preventBrowserFileDrop } from './composer-upload-drop';

type ComposerUploadSurfaceProps = {
  origin: Extract<WorkspaceUploadOrigin, 'composer' | 'quickstart'>;
  projectId: string | null;
  disabled: boolean;
  dropDescId: string;
  surfaceRef?: HTMLElement | undefined;
  registerFileInput?: (element: HTMLInputElement | undefined) => void;
  getDraft: () => string;
  setDraft: (text: string) => void;
  focusAt: (caret: number) => void;
  readCaret: () => { start: number; end: number };
};

/** Composer / QuickStart 共享：drop、键盘选文件、上传磁贴与引用注入。 */
export function ComposerUploadSurface(props: ComposerUploadSurfaceProps) {
  const [dropActive, setDropActive] = createSignal(false);
  const [successBadges, setSuccessBadges] = createSignal<Record<string, boolean>>({});
  let fileInputRef: HTMLInputElement | undefined;

  const batchItems = () => {
    const batch = workspaceUploadBatch();
    if (!batch || !props.projectId || batch.projectId !== props.projectId) return [];
    return batch.items.filter((item) => workspaceUploadOrigin(item.id) === props.origin);
  };

  const uploadDisabled = () => props.disabled || !workspaceUploadAvailable(props.projectId);
  const blockedMessage = () => props.disabled
    ? 'Upload is unavailable while the composer is disabled.'
    : workspaceUploadBlockedMessage(props.projectId);

  const notifyBlocked = (message: string) => {
    if (typeof document !== 'undefined') {
      const node = document.getElementById(props.dropDescId);
      if (node) node.textContent = message;
    }
  };

  const queueFiles = (files: readonly File[]) => {
    if (!props.projectId || uploadDisabled()) {
      notifyBlocked(blockedMessage());
      return;
    }
    const enqueue = props.origin === 'composer'
      ? enqueueComposerRootUpload
      : enqueueQuickStartRootUpload;
    enqueue(props.projectId, files);
    props.focusAt(props.readCaret().start);
  };

  const onDrop = (event: DragEvent) => {
    preventBrowserFileDrop(event);
    setDropActive(false);
    if (uploadDisabled()) {
      notifyBlocked(blockedMessage());
      return;
    }
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const parsed = parseFileDropTransfer(transfer);
    if (!parsed.ok) {
      notifyBlocked(parsed.reason === 'directory'
        ? 'Folders are not supported yet. Upload individual files instead.'
        : 'No files detected in drop.');
      return;
    }
    queueFiles(parsed.files);
  };

  const onPickFiles = (files: FileList | null) => {
    if (!files?.length) return;
    queueFiles(Array.from(files));
    if (fileInputRef) fileInputRef.value = '';
  };

  createEffect(() => {
    const node = props.surfaceRef;
    if (!node) return;
    const onEnter = (event: DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      preventBrowserFileDrop(event);
      if (uploadDisabled()) {
        notifyBlocked(blockedMessage());
        return;
      }
      setDropActive(true);
    };
    const onOver = (event: DragEvent) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      preventBrowserFileDrop(event);
      if (uploadDisabled()) {
        notifyBlocked(blockedMessage());
        return;
      }
      setDropActive(true);
    };
    const onLeave = (event: DragEvent) => {
      if (node.contains(event.relatedTarget as Node | null)) return;
      setDropActive(false);
    };
    node.addEventListener('dragenter', onEnter);
    node.addEventListener('dragover', onOver);
    node.addEventListener('dragleave', onLeave);
    node.addEventListener('drop', onDrop);
    onCleanup(() => {
      node.removeEventListener('dragenter', onEnter);
      node.removeEventListener('dragover', onOver);
      node.removeEventListener('dragleave', onLeave);
      node.removeEventListener('drop', onDrop);
    });
  });

  createEffect(() => {
    props.surfaceRef?.classList.toggle('composer-surface--drop-target', dropActive());
  });

  createEffect(() => {
    for (const item of batchItems()) {
      if (item.phase === 'ready' && !successBadges()[item.id]) {
        setSuccessBadges((current) => ({ ...current, [item.id]: true }));
        window.setTimeout(() => {
          setSuccessBadges((current) => {
            const next = { ...current };
            delete next[item.id];
            return next;
          });
        }, 1000);
      }
    }
  });

  createEffect(() => {
    const items = batchItems();
    for (const item of items) {
      if (item.phase !== 'ready' || item.referenceInjected || !item.committedPath) continue;
      const path = item.committedPath;
      if (draftContainsReferenceToken(props.getDraft(), path)) {
        markWorkspaceUploadReferenceInjected(item.id);
        continue;
      }
      const caret = props.readCaret();
      const applied = applyFileReferenceWithBudget(
        props.getDraft(),
        caret.start,
        caret.end,
        path,
        promptMaxBytes(),
      );
      if (!applied.ok) {
        notifyBlocked('Message is too large to add another file reference.');
        continue;
      }
      props.setDraft(applied.text);
      props.focusAt(applied.caret);
      markWorkspaceUploadReferenceInjected(item.id);
    }
  });

  createEffect(() => {
    props.registerFileInput?.(fileInputRef);
  });

  return (
    <>
      <ComposerDropOverlay active={dropActive()} describedById={props.dropDescId} />
      <p class="sr-only" id={props.dropDescId} aria-live="polite">
        {workspaceUploadLiveMessage() || 'Release to upload files to this project.'}
      </p>
      <Show when={batchItems().length > 0}>
        <div class="composer-assets ui-scrollbar flex gap-7 overflow-x-auto pb-7" aria-label="Uploads">
          <For each={batchItems()}>{(item) => (
            <UploadAssetTile
              name={item.displayName}
              status={workspaceUploadTileStatus(item)}
              progress={workspaceUploadProgressPercent(item)}
              errorMessage={item.error?.message}
              showSuccessBadge={!!successBadges()[item.id]}
              onRetry={item.error?.retryable ? () => retryWorkspaceUpload(item.id) : undefined}
            />
          )}</For>
        </div>
      </Show>
      <input
        ref={(element) => {
          fileInputRef = element;
          props.registerFileInput?.(element);
        }}
        type="file"
        multiple
        class="sr-only"
        aria-hidden="true"
        tabindex={-1}
        data-testid="composer-upload-file-input"
        onChange={(event) => onPickFiles(event.currentTarget.files)}
      />
    </>
  );
}

export function openComposerUploadFilePicker(input: HTMLInputElement | undefined): void {
  input?.click();
}
