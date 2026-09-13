import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { promptMaxBytes } from '@/features/connection/connection';
import { parseClipboardImageFiles } from '@/features/composer/composer-clipboard-images';
import { applyFileReferenceWithBudget, draftContainsReferenceToken } from '@/features/composer/composer-file-reference';
import {
  enqueueComposerRootUpload,
  enqueueQuickStartRootUpload,
  markWorkspaceUploadReferenceInjected,
  workspaceUploadAvailable,
  workspaceUploadBatch,
  workspaceUploadBlockedMessage,
  workspaceUploadLiveMessage,
  workspaceUploadOrigin,
  type WorkspaceUploadOrigin,
} from '@/store';
import { ComposerDropOverlay } from '@peri/ui';
import { dataTransferHasFiles, parseFileDropTransfer, preventBrowserFileDrop } from './composer-upload-drop';

type ComposerUploadSurfaceProps = {
  origin: Extract<WorkspaceUploadOrigin, 'composer' | 'quickstart'>;
  projectId: string | null;
  disabled: boolean;
  dropDescId: string;
  surfaceRef?: HTMLElement | Accessor<HTMLElement | undefined>;
  registerFileInput?: (element: HTMLInputElement | undefined) => void;
  getDraft: () => string;
  setDraft: (text: string) => void;
  focusAt: (caret: number) => void;
  readCaret: () => { start: number; end: number };
};

function resolveSurfaceRef(ref: ComposerUploadSurfaceProps['surfaceRef']): HTMLElement | undefined {
  const value = typeof ref === 'function' ? ref() : ref;
  return value instanceof HTMLElement ? value : undefined;
}

/** Composer / QuickStart 共享：drop、粘贴图片、键盘选文件、上传磁贴与引用注入。 */
export function ComposerUploadSurface(props: ComposerUploadSurfaceProps) {
  const [dropActive, setDropActive] = createSignal(false);
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

  const onPaste = (event: ClipboardEvent) => {
    const files = parseClipboardImageFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (uploadDisabled()) {
      notifyBlocked(blockedMessage());
      return;
    }
    queueFiles(files);
  };

  createEffect(() => {
    const node = resolveSurfaceRef(props.surfaceRef);
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
    node.addEventListener('paste', onPaste, true);
    onCleanup(() => {
      node.removeEventListener('dragenter', onEnter);
      node.removeEventListener('dragover', onOver);
      node.removeEventListener('dragleave', onLeave);
      node.removeEventListener('drop', onDrop);
      node.removeEventListener('paste', onPaste, true);
    });
  });

  createEffect(() => {
    const node = resolveSurfaceRef(props.surfaceRef);
    if (!node) return;
    if (dropActive()) node.setAttribute('data-drop-active', '');
    else node.removeAttribute('data-drop-active');
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
