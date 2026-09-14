import type { Accessor } from 'solid-js';

export type MaybeAccessor<T> = T | Accessor<T>;

export function read<T>(value: MaybeAccessor<T>): T {
  return typeof value === 'function' ? (value as Accessor<T>)() : value;
}

export function asAccessor<T>(value: MaybeAccessor<T>): Accessor<T> {
  return typeof value === 'function' ? value as Accessor<T> : () => value;
}
