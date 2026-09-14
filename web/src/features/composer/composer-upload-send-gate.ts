import type { WorkspaceUploadBatchView } from '@/features/resource/upload-workspace-file';

type ComposerUploadOrigin = 'composer';

export interface ComposerUploadSendGate {
  sendLocked: boolean;
  notice: string | null;
}

/** Composer 草稿区存在未就绪上传时禁止发送，避免引用注入落到下一条草稿。 */
export function composerUploadSendGate(
  batch: WorkspaceUploadBatchView | null,
  projectId: string | null,
  origin: ComposerUploadOrigin,
  resolveOrigin: (itemId: string) => string | undefined,
): ComposerUploadSendGate {
  if (!batch || !projectId || batch.projectId !== projectId) {
    return { sendLocked: false, notice: null };
  }
  const pending = batch.items.filter(
    (item) => resolveOrigin(item.id) === origin
      && item.phase !== 'ready'
      && item.phase !== 'failed',
  );
  if (pending.length === 0) return { sendLocked: false, notice: null };
  return {
    sendLocked: true,
    notice: 'Wait for attachments to finish uploading before sending.',
  };
}
