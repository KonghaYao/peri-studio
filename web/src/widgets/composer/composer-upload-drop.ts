/** OS 拖放解析：v1 拒绝目录，仅接受扁平 File 列表。 */

export type DropTransferParseResult =
  | { ok: true; files: File[] }
  | { ok: false; reason: 'empty' | 'directory' };

export function dataTransferHasDirectory(dataTransfer: DataTransfer): boolean {
  const items = dataTransfer.items;
  if (!items?.length) return false;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const entry = item.webkitGetAsEntry?.() ?? null;
    if (entry?.isDirectory) return true;
  }
  return false;
}

export function dataTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (Array.from(dataTransfer.types ?? []).includes('Files')) return true;
  if (dataTransfer.files?.length) return true;
  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file' || !!item.webkitGetAsEntry?.());
}

export function parseFileDropTransfer(dataTransfer: DataTransfer): DropTransferParseResult {
  if (dataTransferHasDirectory(dataTransfer)) {
    return { ok: false, reason: 'directory' };
  }
  const files = Array.from(dataTransfer.files ?? []).filter((file) => file.size >= 0);
  if (!files.length) return { ok: false, reason: 'empty' };
  return { ok: true, files };
}

export function preventBrowserFileDrop(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}
