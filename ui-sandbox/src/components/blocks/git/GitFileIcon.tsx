import { File, FileCode2, FileJson, FileText, FileType2 } from 'lucide-solid';
import { cn } from '@/lib/cn';

function iconForPath(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'rs' || ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') return FileCode2;
  if (ext === 'md') return FileText;
  if (ext === 'json' || ext === 'toml') return FileJson;
  if (ext === 'css' || ext === 'scss') return FileType2;
  return File;
}

/** SCM 文件行图标（按扩展名区分，sandbox 简化版）。 */
export function GitFileIcon(props: { path: string; class?: string }) {
  const Icon = iconForPath(props.path);
  return <Icon size={14} strokeWidth={1.7} class={cn('shrink-0 text-content-muted', props.class)} aria-hidden="true" />;
}
