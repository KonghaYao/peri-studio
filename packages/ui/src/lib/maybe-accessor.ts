import type { Accessor } from 'solid-js';

/** 快照值或 Solid accessor，供 T3 props 双态消费。 */
export type MaybeAccessor<T> = T | Accessor<T>;

export function isAccessor<T>(value: MaybeAccessor<T>): value is Accessor<T> {
  return typeof value === 'function';
}

/** 将 MaybeAccessor 规范化为 accessor，便于在 JSX 与 `<For each>` 中订阅。 */
export function asAccessor<T>(value: MaybeAccessor<T>): Accessor<T> {
  return isAccessor(value) ? value : () => value;
}
