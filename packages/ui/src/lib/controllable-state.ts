import { createMemo, createSignal, type Accessor } from 'solid-js';

type ControllableOptions<T> = {
  prop?: Accessor<T | undefined>;
  defaultProp?: T;
  onChange?: (value: T) => void;
};

/** Solid 版受控/非受控状态：prop 存在时为受控，否则走内部 signal。 */
export function createControllableSignal<T>(options: ControllableOptions<T>) {
  const [uncontrolled, setUncontrolled] = createSignal(options.defaultProp as T);
  const isControlled = createMemo(() => options.prop?.() !== undefined);
  const value = createMemo(() => (isControlled() ? options.prop!()! : uncontrolled()));

  const setValue = (next: T) => {
    if (!isControlled()) {
      setUncontrolled(() => next);
    }
    options.onChange?.(next);
  };

  return [value, setValue] as const;
}
