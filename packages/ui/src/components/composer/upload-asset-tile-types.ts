export type UploadAssetTileStatus =
  | 'pending'
  | 'uploading'
  | 'committing'
  | 'ready'
  | 'failed';

export type UploadAssetTileProps = {
  name: string;
  status: UploadAssetTileStatus;
  /** uploading 态 0–100 */
  progress?: number;
  /** failed 态简短英文文案 */
  errorMessage?: string;
  /** ready 态短暂显示成功角标 */
  showSuccessBadge?: boolean;
  /** 图片类附件缩略图（object-fit: cover 铺满方块） */
  previewUrl?: string;
  onRemove?: () => void;
  onRetry?: () => void;
  'data-testid'?: string;
};
