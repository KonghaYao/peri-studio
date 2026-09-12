import { ComposerAttachmentList, type ComposerAttachmentItem } from '@peri/ui';
import { composerAssets, removeComposerAsset } from '@/features/composer/composer-assets';

/** Composer 顶部 staged assets 横条（composerAssets 夹具）。 */
export function ComposerStagedAssets() {
  const items = (): ComposerAttachmentItem[] => composerAssets().map((asset) => ({
    id: asset.id,
    name: asset.name,
    kind: asset.kind === 'image' ? 'image' : 'file',
    status: 'ready',
    previewUrl: asset.previewUrl,
    onRemove: () => removeComposerAsset(asset.id),
  }));

  return <ComposerAttachmentList items={items()} />;
}
