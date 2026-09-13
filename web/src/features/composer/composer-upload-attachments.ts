import { composerAttachmentKind, type ComposerAttachmentItem } from '@peri/ui';
import { removeFileReferenceToken } from '@/features/composer/composer-file-reference';
import type { WorkspaceUploadBatchView, WorkspaceUploadItemView } from '@/features/resource/upload-workspace-file';
import type { WorkspaceUploadOrigin } from '@/store';

type ComposerUploadOrigin = Extract<WorkspaceUploadOrigin, 'composer' | 'quickstart'>;

export function composerUploadAttachmentRemove(input: {
  item: WorkspaceUploadItemView;
  dismiss: (itemId: string) => void;
  getDraft: () => string;
  setDraft: (text: string) => void;
}): () => void {
  return () => {
    const path = input.item.committedPath;
    input.dismiss(input.item.id);
    if (!path) return;
    input.setDraft(removeFileReferenceToken(input.getDraft(), path));
  };
}

export function workspaceUploadAttachmentItems(input: {
  batch: WorkspaceUploadBatchView | null;
  projectId: string | null;
  origin: ComposerUploadOrigin;
  resolveOrigin: (itemId: string) => WorkspaceUploadOrigin | undefined;
  tileStatus: (item: WorkspaceUploadItemView) => NonNullable<ComposerAttachmentItem['status']>;
  progressPercent: (item: WorkspaceUploadItemView) => number;
  retry: (itemId: string) => void;
  dismiss: (itemId: string) => void;
  getDraft: () => string;
  setDraft: (text: string) => void;
}): ComposerAttachmentItem[] {
  const { batch, projectId, origin } = input;
  if (!batch || !projectId || batch.projectId !== projectId) return [];

  return batch.items
    .filter((item) => input.resolveOrigin(item.id) === origin)
    .map((item) => {
      const status = input.tileStatus(item);
      return {
        id: item.id,
        name: item.displayName,
        kind: composerAttachmentKind(item.displayName),
        status,
        progress: input.progressPercent(item),
        errorMessage: item.error?.message,
        onRetry: item.error?.retryable ? () => input.retry(item.id) : undefined,
        onRemove: status === 'ready'
          ? composerUploadAttachmentRemove({
            item,
            dismiss: input.dismiss,
            getDraft: input.getDraft,
            setDraft: input.setDraft,
          })
          : undefined,
      };
    });
}
