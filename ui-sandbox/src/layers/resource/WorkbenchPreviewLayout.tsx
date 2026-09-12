import { createMemo } from 'solid-js';
import { FilePreviewPanel } from '@peri/ui';
import { resolveWorkbenchPreview, type WorkbenchPreview } from './workbench-preview-data';

/** Tier 4 · Workbench 左侧文件 / diff 预览。 */
export function WorkbenchPreviewLayout(props: { preview: WorkbenchPreview | null }) {
  const resolved = createMemo(() => resolveWorkbenchPreview(props.preview));

  return (
    <FilePreviewPanel
      path={resolved()?.path ?? ''}
      mode={resolved()?.mode ?? 'text'}
      lines={resolved()?.lines}
      readOnly
    />
  );
}
