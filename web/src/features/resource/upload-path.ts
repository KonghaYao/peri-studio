/** 与 proto `MAX_RESOURCE_BLOB_BYTES` 对齐的单文件上传上限。 */
export const MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024;

/** Web 侧并行 PUT 上限（技术默认）。 */
export const MAX_CONCURRENT_UPLOAD_PUTS = 3;

export type UploadPathRejectReason =
  | 'empty_name'
  | 'unrepresentable_name'
  | 'path_in_name'
  | 'too_large';

export interface LocalUploadCandidate {
  /** 客户端稳定 id（队列/UI 键）。 */
  id: string;
  /** 仅来自 `File.name`，不可信 `webkitRelativePath` / 绝对 path。 */
  displayName: string;
  size: number;
  blob: Blob;
  workspaceRelativePath: string;
}

export type PickLocalUploadResult =
  | { ok: true; candidate: LocalUploadCandidate }
  | { ok: false; reason: UploadPathRejectReason; displayName: string };

/** 消毒 basename：只保留最终段，拒绝路径分隔与空名。 */
export function sanitizeUploadBasename(rawName: string): string | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  const base = trimmed.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!base || base === '.' || base === '..') return null;
  if (base.includes('\0')) return null;
  if (/[/\\]/.test(base)) return null;
  return base;
}

/** 拼接 workspace-relative 目标路径（POSIX，`directory` 可为 `""`）。 */
export function joinWorkspaceUploadPath(directoryPath: string, basename: string): string {
  const dir = directoryPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const base = basename.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!dir) return base;
  if (!base) return dir;
  return `${dir}/${base}`;
}

/** Composer drop：写入 project workspace 根。 */
export function composerWorkspaceUploadPath(basename: string): string {
  return joinWorkspaceUploadPath('', basename);
}

function rejectPick(displayName: string, reason: UploadPathRejectReason): PickLocalUploadResult {
  return { ok: false, reason, displayName };
}

/** 从 OS `File` 构造上传候选（v1 扁平单文件，不信任 `file.path`）。 */
export function pickLocalUploadFile(
  file: File,
  id: string,
  targetDirectoryPath: string,
): PickLocalUploadResult {
  const displayName = typeof file.name === 'string' ? file.name : '';
  const basename = sanitizeUploadBasename(displayName);
  if (!basename) return rejectPick(displayName, 'empty_name');
  if (basename !== displayName.trim() && displayName.includes('/')) {
    return rejectPick(displayName, 'path_in_name');
  }
  if (displayName.includes('\\') || displayName.includes('/')) {
    return rejectPick(displayName, 'path_in_name');
  }
  const size = file.size;
  if (!Number.isFinite(size) || size < 0) return rejectPick(displayName, 'unrepresentable_name');
  if (size > MAX_UPLOAD_FILE_BYTES) return rejectPick(displayName, 'too_large');
  const workspaceRelativePath = joinWorkspaceUploadPath(targetDirectoryPath, basename);
  return {
    ok: true,
    candidate: {
      id,
      displayName: basename,
      size,
      blob: file,
      workspaceRelativePath,
    },
  };
}

/** v1：目录拖入由 widget 层拒绝；此处仅接受已展开的 `File` 列表。 */
export function pickLocalUploadFiles(
  files: readonly File[],
  targetDirectoryPath: string,
  idFactory: () => string = () => crypto.randomUUID(),
): PickLocalUploadResult[] {
  return files.map((file) => pickLocalUploadFile(file, idFactory(), targetDirectoryPath));
}
