import type { UploadAssetTileStatus } from './upload-asset-tile-types';

export type ComposerAttachmentKind = 'image' | 'file';

export type ComposerAttachmentItem = {
  id: string;
  name: string;
  kind?: ComposerAttachmentKind;
  status?: UploadAssetTileStatus;
  progress?: number;
  errorMessage?: string;
  previewUrl?: string;
  showSuccessBadge?: boolean;
  onRemove?: () => void;
  onRetry?: () => void;
};

export function composerAttachmentKind(name: string, kind?: ComposerAttachmentKind): ComposerAttachmentKind {
  if (kind) return kind;
  const lower = name.toLowerCase();
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')) {
    return 'image';
  }
  return 'file';
}
