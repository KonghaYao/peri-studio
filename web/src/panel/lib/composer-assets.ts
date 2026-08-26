import { createSignal } from 'solid-js';

export type ComposerAssetKind = 'file' | 'image' | 'reference';

export interface ComposerAssetInfo {
  id: string;
  name: string;
  kind: ComposerAssetKind;
  detail?: string;
  previewUrl?: string;
}

const [composerAssets, setComposerAssets] = createSignal<ComposerAssetInfo[]>([]);

export function removeComposerAsset(id: string) {
  setComposerAssets((assets) => assets.filter((asset) => asset.id !== id));
}

export { composerAssets, setComposerAssets };
