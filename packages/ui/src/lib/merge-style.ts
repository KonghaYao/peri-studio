import type { JSX } from 'solid-js';

/** 合并内联 style，忽略 string 类型的 className style。 */
export function mergeInlineStyle(
  style: string | JSX.CSSProperties | undefined,
  patch: JSX.CSSProperties,
): JSX.CSSProperties | undefined {
  const base =
    typeof style === 'object' && style !== null ? { ...style } : ({} as JSX.CSSProperties);
  const merged = { ...base, ...patch };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
