/** 从剪贴板提取可上传的位图；截图匿名名会换成唯一 `clipboard-*`，避免 create-only 冲突。 */

const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
};

const GENERIC_CLIPBOARD_NAME = /^image\.(png|jpe?g|gif|webp|avif|bmp)$/i;

export function isAllowedClipboardImageMime(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME.has((mimeType || '').toLowerCase());
}

export function clipboardImageExtension(mimeType: string, fileName = ''): string {
  const fromMime = MIME_EXTENSION[mimeType.toLowerCase()];
  if (fromMime) return fromMime;
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] && MIME_EXTENSION[`image/${match[1] === 'jpeg' ? 'jpeg' : match[1]}`]
    ? (match[1] === 'jpeg' ? 'jpg' : match[1])
    : 'png';
}

export function isGenericClipboardImageName(name: string): boolean {
  const trimmed = name.trim();
  return !trimmed || GENERIC_CLIPBOARD_NAME.test(trimmed);
}

export function formatClipboardImageStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

export function uniqueClipboardImageName(file: File, index: number, now: Date): string {
  const extension = clipboardImageExtension(file.type, file.name);
  const stamp = formatClipboardImageStamp(now);
  const suffix = index > 0 ? `-${index + 1}` : '';
  return `clipboard-${stamp}${suffix}.${extension}`;
}

export function normalizeClipboardImageFile(file: File, index: number, now: Date): File {
  if (!isGenericClipboardImageName(file.name)) return file;
  return new File([file], uniqueClipboardImageName(file, index, now), {
    type: file.type || `image/${clipboardImageExtension(file.type, file.name)}`,
    lastModified: file.lastModified,
  });
}

function filesFromClipboardItems(data: DataTransfer): File[] {
  const items = data.items;
  if (!items?.length) return [];
  const files: File[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== 'file' || !isAllowedClipboardImageMime(item.type)) continue;
    const file = item.getAsFile?.();
    if (file) files.push(file);
  }
  return files;
}

/** 只收集位图。有图片时由调用方 preventDefault，避免把二进制糊进 textarea。 */
export function parseClipboardImageFiles(data: DataTransfer | null, now: Date = new Date()): File[] {
  if (!data) return [];
  const raw = filesFromClipboardItems(data);
  const files = raw.length
    ? raw
    : Array.from(data.files ?? []).filter((file) => isAllowedClipboardImageMime(file.type));
  return files.map((file, index) => normalizeClipboardImageFile(file, index, now));
}
