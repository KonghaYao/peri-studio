import { createEffect, createSignal, onCleanup, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  WORKBENCH_PANEL_KEYBOARD_STEP,
  clampWorkbenchPanelWidth,
  persistWorkbenchPanelWidth,
  readStoredWorkbenchPanelWidth,
  workbenchPanelWidthLimits,
  type WorkbenchPanelWidthProfile,
} from './workbench-panel-layout';
import {
  WORKBENCH_PANEL_RESIZING_BODY_CLASS,
  workbenchFloatingPanelLeftClass,
  workbenchFloatingPanelRightClass,
  workbenchPanelResizeGripClass,
  workbenchPanelResizeGripDraggingClass,
  workbenchPanelResizeHandleClass,
  workbenchPanelResizeHandleDraggingClass,
} from './workbench-layout';

export type WorkbenchFloatingPanelProps = {
  children: JSX.Element;
  class?: string;
  'data-testid'?: string;
  /** workspace = Explorer/SCM；graph = Git Graph；preview = 左侧文件预览。 */
  widthProfile?: WorkbenchPanelWidthProfile;
  /** 右侧资源轨（默认）或左侧文件预览（贴主侧栏右缘）。 */
  anchor?: 'left' | 'right';
  /** anchor=left 时面板左缘距视口左边的像素（通常为侧栏宽度 + 间距）。 */
  leftOffset?: number;
  /** 受控宽度；省略时按 profile 从 sessionStorage 读写。 */
  width?: number;
  onWidthChange?: (width: number) => void;
};

/** T3 · 桌面浮动面板壳：绝对定位、圆角阴影与拖拽调宽（无业务状态）。 */
export const WorkbenchFloatingPanel: Component<WorkbenchFloatingPanelProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'widthProfile',
    'anchor',
    'leftOffset',
    'width',
    'onWidthChange',
  ]);

  const profile = () => local.widthProfile ?? 'workspace';
  const anchor = () => local.anchor ?? 'right';
  const limits = () => workbenchPanelWidthLimits(profile());

  const [internalWidth, setInternalWidth] = createSignal(readStoredWorkbenchPanelWidth(profile()));
  const [resizing, setResizing] = createSignal(false);
  let panelRight = 0;
  let panelLeft = 0;

  const width = () => local.width ?? internalWidth();

  createEffect(() => {
    profile();
    if (local.width === undefined) {
      setInternalWidth(readStoredWorkbenchPanelWidth(profile()));
    }
  });

  const setClampedWidth = (next: number) => {
    const p = profile();
    const clamped = clampWorkbenchPanelWidth(next, p);
    if (local.width === undefined) {
      setInternalWidth(clamped);
      persistWorkbenchPanelWidth(clamped, p);
    }
    local.onWidthChange?.(clamped);
  };

  const stopResize = () => {
    window.removeEventListener('pointermove', resizeWithPointer);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    document.body.classList.remove(WORKBENCH_PANEL_RESIZING_BODY_CLASS);
    setResizing(false);
  };

  const resizeWithPointer = (event: PointerEvent) => {
    if (anchor() === 'left') {
      setClampedWidth(event.clientX - panelLeft);
      return;
    }
    setClampedWidth(panelRight - event.clientX);
  };

  const startResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const panel = (event.currentTarget as HTMLElement).closest('[data-ui-workbench-floating-panel]');
    if (panel) {
      const rect = panel.getBoundingClientRect();
      panelRight = rect.right;
      panelLeft = rect.left;
    }
    document.body.classList.add(WORKBENCH_PANEL_RESIZING_BODY_CLASS);
    setResizing(true);
    window.addEventListener('pointermove', resizeWithPointer);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  const resizeWithKeyboard = (event: KeyboardEvent) => {
    const { minWidth, maxWidth } = limits();
    const step = event.shiftKey ? WORKBENCH_PANEL_KEYBOARD_STEP * 2 : WORKBENCH_PANEL_KEYBOARD_STEP;
    if (anchor() === 'left') {
      if (event.key === 'ArrowRight') setClampedWidth(width() + step);
      else if (event.key === 'ArrowLeft') setClampedWidth(width() - step);
    } else {
      if (event.key === 'ArrowLeft') setClampedWidth(width() + step);
      else if (event.key === 'ArrowRight') setClampedWidth(width() - step);
    }
    if (event.key === 'Home') setClampedWidth(minWidth);
    else if (event.key === 'End') setClampedWidth(maxWidth);
    else return;
    event.preventDefault();
  };

  onCleanup(stopResize);

  const shellClass = () => (anchor() === 'left'
    ? workbenchFloatingPanelLeftClass
    : workbenchFloatingPanelRightClass);

  const panelStyle = () => {
    const base: Record<string, string> = { width: `${width()}px` };
    if (anchor() === 'left') {
      base.left = `${local.leftOffset ?? 0}px`;
    }
    return base;
  };

  const resizeHandleSide = () => (anchor() === 'left' ? 'right' : 'left');

  return (
    <div
      data-ui-workbench-floating-panel
      data-resource-floating-panel
      data-testid={rest['data-testid']}
      data-width-profile={profile()}
      data-panel-anchor={anchor()}
      class={cn(shellClass(), 'flex min-h-0 min-w-0 flex-col', local.class)}
      style={panelStyle()}
    >
      <div
        class={cn(
          workbenchPanelResizeHandleClass,
          resizeHandleSide() === 'left' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2',
          resizing() && workbenchPanelResizeHandleDraggingClass,
        )}
        role="separator"
        aria-label="Resize resource panel"
        aria-orientation="vertical"
        aria-valuemin={limits().minWidth}
        aria-valuemax={limits().maxWidth}
        aria-valuenow={width()}
        aria-valuetext={`${width()} pixels wide`}
        tabIndex={0}
        onKeyDown={resizeWithKeyboard}
      >
        <span
          aria-hidden="true"
          class={cn(
            workbenchPanelResizeGripClass,
            resizeHandleSide() === 'left' ? 'left-5' : 'right-5',
            resizing() && workbenchPanelResizeGripDraggingClass,
          )}
          onPointerDown={startResize}
        />
      </div>
      {local.children}
    </div>
  );
};
