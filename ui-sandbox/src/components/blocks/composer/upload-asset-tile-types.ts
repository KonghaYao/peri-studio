/** Composer 上传资产磁贴状态（sandbox 视觉契约；生产 mirror 同语义）。 */
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
  onRemove?: () => void;
  onRetry?: () => void;
};
