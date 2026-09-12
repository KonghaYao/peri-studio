import {
  createContext,
  createSignal,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { clamp, cn } from '../lib/cn';

type Direction = 'horizontal' | 'vertical';

type PanelConstraints = {
  minSize: number;
  maxSize: number;
};

type PanelRegistration = {
  defaultSize: number;
  constraints: PanelConstraints;
};

type ResizablePanelGroupContextValue = {
  direction: () => Direction;
  sizes: () => number[];
  registerPanel: (registration: PanelRegistration) => number;
  registerHandle: () => number;
  resizePair: (leadingIndex: number, leadingSize: number, trailingSize: number) => void;
  getConstraints: (index: number) => PanelConstraints;
  groupRef: () => HTMLDivElement | undefined;
  setGroupRef: (node: HTMLDivElement | undefined) => void;
};

const ResizablePanelGroupContext = createContext<ResizablePanelGroupContextValue>();

function useResizablePanelGroupContext(component: string) {
  const context = useContext(ResizablePanelGroupContext);
  if (!context) {
    throw new Error(`${component} must be used within ResizablePanelGroup`);
  }
  return context;
}

function normalizeSizes(registrations: PanelRegistration[]): number[] {
  if (registrations.length === 0) return [];
  const totalDefault = registrations.reduce((sum, panel) => sum + panel.defaultSize, 0);
  const scale = totalDefault > 0 ? 100 / totalDefault : 100 / registrations.length;
  return registrations.map((panel) => panel.defaultSize * scale);
}

/** 可拖拽调整大小的面板组容器。 */
export const ResizablePanelGroup: Component<ComponentProps<'div'> & { direction?: Direction }> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'direction', 'children']);
  const direction = () => local.direction ?? 'horizontal';
  const registrations: PanelRegistration[] = [];
  const [sizes, setSizes] = createSignal<number[]>([]);
  let groupElement: HTMLDivElement | undefined;
  let handleCount = 0;

  const registerPanel = (registration: PanelRegistration) => {
    const index = registrations.length;
    registrations.push(registration);
    setSizes(normalizeSizes(registrations));
    return index;
  };

  const resizePair = (leadingIndex: number, leadingSize: number, trailingSize: number) => {
    setSizes((current) => {
      if (leadingIndex < 0 || leadingIndex + 1 >= current.length) return current;
      const next = [...current];
      next[leadingIndex] = leadingSize;
      next[leadingIndex + 1] = trailingSize;
      return next;
    });
  };

  const registerHandle = () => {
    const index = handleCount;
    handleCount += 1;
    return index;
  };

  const context: ResizablePanelGroupContextValue = {
    direction,
    sizes,
    registerPanel,
    registerHandle,
    resizePair,
    getConstraints: (index) => registrations[index]?.constraints ?? { minSize: 0, maxSize: 100 },
    groupRef: () => groupElement,
    setGroupRef: (node) => { groupElement = node; },
  };

  return (
    <ResizablePanelGroupContext.Provider value={context}>
      <div
        data-slot="resizable-panel-group"
        data-direction={direction()}
        ref={(node) => { groupElement = node; }}
        class={cn(
          'flex size-full',
          direction() === 'vertical' ? 'flex-col' : 'flex-row',
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </div>
    </ResizablePanelGroupContext.Provider>
  );
};

type ResizablePanelProps = ComponentProps<'div'> & {
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
};

/** 面板：尺寸以百分比表示，由组内拖拽句柄调节。 */
export const ResizablePanel: Component<ResizablePanelProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'defaultSize', 'minSize', 'maxSize', 'style', 'children']);
  const context = useResizablePanelGroupContext('ResizablePanel');
  const panelIndex = context.registerPanel({
    defaultSize: local.defaultSize ?? 100,
    constraints: {
      minSize: local.minSize ?? 0,
      maxSize: local.maxSize ?? 100,
    },
  });

  const panelStyle = (): JSX.CSSProperties => {
    const index = panelIndex;
    const base = typeof local.style === 'object' ? local.style : undefined;
    const size = context.sizes()[index];
    const isVertical = context.direction() === 'vertical';
    return {
      ...base,
      flex: `${size} 1 0%`,
      overflow: 'hidden',
      ...(isVertical ? { minHeight: 0 } : { minWidth: 0 }),
    };
  };

  return (
    <div
      data-slot="resizable-panel"
      data-panel-index={panelIndex}
      style={panelStyle()}
      class={cn('relative', local.class)}
      {...rest}
    >
      {local.children}
    </div>
  );
};

type ResizableHandleProps = ComponentProps<'div'> & {
  /** 句柄左侧（或上方）面板索引；默认取紧邻的前一个面板。 */
  panelIndex?: number;
  disabled?: boolean;
};

/** 拖拽句柄：夹在两个面板之间调节相邻尺寸。 */
export const ResizableHandle: Component<ResizableHandleProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'panelIndex', 'disabled']);
  const context = useResizablePanelGroupContext('ResizableHandle');
  const isVertical = () => context.direction() === 'vertical';
  const [handleIndex] = createSignal(local.panelIndex ?? context.registerHandle());
  const leadingIndex = () => handleIndex();

  const onPointerDown = (event: PointerEvent) => {
    if (local.disabled) return;
    event.preventDefault();
    const index = leadingIndex();
    const group = context.groupRef();
    if (!group || index < 0 || index + 1 >= context.sizes().length) return;

    const startSizes = [...context.sizes()];
    const startPosition = isVertical() ? event.clientY : event.clientX;
    const groupSize = isVertical() ? group.offsetHeight : group.offsetWidth;
    if (groupSize <= 0) return;

    const leadingConstraints = context.getConstraints(index);
    const trailingConstraints = context.getConstraints(index + 1);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaPx = (isVertical() ? moveEvent.clientY : moveEvent.clientX) - startPosition;
      const deltaPercent = (deltaPx / groupSize) * 100;
      const pairTotal = startSizes[index] + startSizes[index + 1];
      let nextLeading = startSizes[index] + deltaPercent;
      const minLeading = leadingConstraints.minSize;
      const maxLeading = pairTotal - trailingConstraints.minSize;
      nextLeading = clamp(nextLeading, minLeading, Math.min(leadingConstraints.maxSize, maxLeading));
      const nextTrailing = pairTotal - nextLeading;
      context.resizePair(index, nextLeading, nextTrailing);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div
      data-slot="resizable-handle"
      role="separator"
      aria-orientation={isVertical() ? 'horizontal' : 'vertical'}
      tabIndex={local.disabled ? -1 : 0}
      data-disabled={local.disabled ? '' : undefined}
      class={cn(
        'group relative shrink-0 touch-none select-none',
        isVertical() ? 'h-12 w-full cursor-row-resize' : 'w-12 cursor-col-resize',
        local.disabled && 'pointer-events-none opacity-45',
        local.class,
      )}
      onPointerDown={onPointerDown}
      {...rest}
    >
      <span
        aria-hidden="true"
        class={cn(
          'pointer-events-none absolute bg-border-subtle ui-control-transition group-hover:bg-sidebar-resize-handle-hover group-focus-visible:bg-sidebar-resize-handle-hover',
          isVertical()
            ? 'inset-x-0 top-1/2 h-px w-full -translate-y-1/2'
            : 'inset-y-0 left-1/2 w-px -translate-x-1/2',
        )}
      />
    </div>
  );
};
