import { createSignal } from 'solid-js';

export type ComposerAssetKind = 'file' | 'image' | 'reference';

export interface ComposerAssetInfo {
  id: string;
  name: string;
  kind: ComposerAssetKind;
  detail?: string;
  previewUrl?: string;
}

export interface ComposerUploadAssetInfo {
  id: string;
  name: string;
  path: string;
}

const [composerAssets, setComposerAssets] = createSignal<ComposerAssetInfo[]>([]);
const uploadAssetIndex = new Map<string, ComposerAssetInfo>();

export function stageComposerUploadAsset(asset: ComposerUploadAssetInfo) {
  const existing = uploadAssetIndex.get(asset.id);
  if (existing) return;
  const entry: ComposerAssetInfo = {
    id: asset.id,
    name: asset.name,
    kind: 'reference',
    detail: asset.path,
  };
  uploadAssetIndex.set(asset.id, entry);
  setComposerAssets((items) => [...items.filter((item) => item.id !== asset.id), entry]);
}

export function removeComposerUploadAsset(id: string) {
  uploadAssetIndex.delete(id);
  removeComposerAsset(id);
}

export function removeComposerAsset(id: string) {
  setComposerAssets((assets) => assets.filter((asset) => asset.id !== id));
}

export { composerAssets, setComposerAssets };
