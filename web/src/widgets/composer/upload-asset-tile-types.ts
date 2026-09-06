export type UploadAssetTileStatus =
  | 'pending'
  | 'uploading'
  | 'committing'
  | 'ready'
  | 'failed';

export interface UploadAssetTileProps {
  name: string;
  status: UploadAssetTileStatus;
  progress?: number;
  errorMessage?: string;
  showSuccessBadge?: boolean;
  onRemove?: () => void;
  onRetry?: () => void;
}
