/** 从绝对路径推导 sidebar 展示用的 project 名称。 */
export function projectNameFromPath(cwd: string): string {
  const trimmed = cwd.trim().replace(/\/+$/, '');
  if (!trimmed) return 'Project';
  const segments = trimmed.split('/').filter(Boolean);
  return segments.at(-1) ?? 'Project';
}
