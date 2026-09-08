import { createEffect, createMemo, createSignal, type Accessor } from 'solid-js';

export interface IdentitySelection<T> {
  index: Accessor<number>;
  current: Accessor<T | undefined>;
  select: (index: number) => void;
}

/** 以领域身份保持队列选择；当前项消失时回退到原位置附近。 */
export function createIdentitySelection<T>(
  items: Accessor<readonly T[]>,
  identity: (item: T) => string,
): IdentitySelection<T> {
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [lastIndex, setLastIndex] = createSignal(0);
  const index = createMemo(() => {
    const values = items();
    if (!values.length) return -1;
    const id = activeId();
    const matched = id ? values.findIndex((item) => identity(item) === id) : -1;
    return matched >= 0 ? matched : Math.min(lastIndex(), values.length - 1);
  });
  const current = createMemo(() => items()[index()]);

  createEffect(() => {
    const position = index();
    const item = current();
    if (!item || position < 0) {
      setActiveId(null);
      setLastIndex(0);
      return;
    }
    setActiveId(identity(item));
    setLastIndex(position);
  });

  const select = (position: number) => {
    const item = items()[position];
    if (!item) return;
    setLastIndex(position);
    setActiveId(identity(item));
  };

  return { index, current, select };
}
