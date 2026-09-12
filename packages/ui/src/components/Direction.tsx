import {
  createContext,
  createMemo,
  createSignal,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';

export type Direction = 'ltr' | 'rtl';

type DirectionContextValue = {
  direction: Accessor<Direction>;
  setDirection?: (direction: Direction) => void;
};

const DirectionContext = createContext<DirectionContextValue>();

export type UseDirectionResult = {
  direction: Accessor<Direction>;
  setDirection?: (direction: Direction) => void;
};

export function useDirection(): UseDirectionResult {
  const context = useContext(DirectionContext);
  if (!context) {
    throw new Error('useDirection must be used within <DirectionProvider>.');
  }
  return context;
}

type DirectionProviderProps = Omit<ComponentProps<'div'>, 'dir'> & {
  /** 受控文本方向，与 shadcn `direction` 对齐 */
  direction?: Direction;
  /** `direction` 别名，便于与 HTML `dir` 语义对齐 */
  dir?: Direction;
  /** 非受控初始方向，默认 `ltr` */
  defaultDirection?: Direction;
  /** 方向变更回调（受控/非受控均可触发） */
  onDirectionChange?: (direction: Direction) => void;
  children?: JSX.Element;
};

export const DirectionProvider: Component<DirectionProviderProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'direction',
    'dir',
    'defaultDirection',
    'onDirectionChange',
    'class',
    'children',
  ]);

  const isControlled = () => local.direction !== undefined || local.dir !== undefined;

  const [uncontrolledDirection, setUncontrolledDirection] = createSignal<Direction>(
    local.defaultDirection ?? 'ltr',
  );

  const resolvedDirection = createMemo<Direction>(() => {
    if (local.direction !== undefined) return local.direction;
    if (local.dir !== undefined) return local.dir;
    return uncontrolledDirection();
  });

  const setDirection = (next: Direction) => {
    if (!isControlled()) {
      setUncontrolledDirection(next);
    }
    local.onDirectionChange?.(next);
  };

  const contextValue: DirectionContextValue = {
    direction: resolvedDirection,
    setDirection,
  };

  return (
    <DirectionContext.Provider value={contextValue}>
      <div
        data-slot="direction-provider"
        dir={resolvedDirection()}
        class={cn(local.class)}
        {...rest}
      >
        {local.children}
      </div>
    </DirectionContext.Provider>
  );
};
