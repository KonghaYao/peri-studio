import { type JSX, createEffect, createSignal, onCleanup } from 'solid-js';
import { cn } from '@/shared/lib/cn';
import {
  WORKBENCH_PANEL_KEYBOARD_STEP,
  RESOURCE_PANEL_FLOATING_SHELL_CLASS,
  RESOURCE_PANEL_FLOATING_SHELL_LEFT_CLASS,
  clampWorkbenchPanelWidth,
  persistWorkbenchPanelWidth,
  readStoredWorkbenchPanelWidth,
  workbenchPanelWidthLimits,
  type WorkbenchPanelWidthProfile,
} from './resource-panel-layout';

type ResourceFloatingPanelProps = {
  children: JSX.Element;
  class?: string;
  'data-testid'?: string;
  /** workspace = Explorer/SCM；graph = Git Graph；preview = 左侧文件预览。 */
  widthProfile?: WorkbenchPanelWidthProfile;
  /** 右侧资源轨（默认）或左侧文件预览（贴主侧栏右缘）。 */
  anchor?: 'left' | 'right';
  /** anchor=left 时面板左缘距视口左边的像素（通常为侧栏宽度 + 间距）。 */
  leftOffset?: number;
};

/** 桌面端浮动面板壳：右侧 Explorer/SCM/Graph，或左侧文件预览。 */
export function ResourceFloatingPanel(props: ResourceFloatingPanelProps) {
  const profile = () => props.widthProfile ?? 'workspace';
  const anchor = () => props.anchor ?? 'right';
  const limits = () => workbenchPanelWidthLimits(profile());

  const [width, setWidth] = createSignal(readStoredWorkbenchPanelWidth(profile()));
  const [resizing, setResizing] = createSignal(false);
  let panelRight = 0;
  let panelLeft = 0;

  createEffect(() => {
    profile();
    setWidth(readStoredWorkbenchPanelWidth(profile()));
  });

  const setClampedWidth = (next: number) => {
    const p = profile();
    const clamped = clampWorkbenchPanelWidth(next, p);
    setWidth(clamped);
    persistWorkbenchPanelWidth(clamped, p);
  };

  const stopResize = () => {
    window.removeEventListener('pointermove', resizeWithPointer);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    document.body.classList.remove('workbench-panel-resizing');
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
    const panel = (event.currentTarget as HTMLElement).closest('[data-resource-floating-panel]');
    if (panel) {
      const rect = panel.getBoundingClientRect();
      panelRight = rect.right;
      panelLeft = rect.left;
    }
    document.body.classList.add('workbench-panel-resizing');
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
    ? RESOURCE_PANEL_FLOATING_SHELL_LEFT_CLASS
    : RESOURCE_PANEL_FLOATING_SHELL_CLASS);

  const panelStyle = () => {
    const base: Record<string, string> = { width: `${width()}px` };
    if (anchor() === 'left') {
      base.left = `${props.leftOffset ?? 0}px`;
    }
    return base;
  };

  const resizeHandleSide = () => (anchor() === 'left' ? 'right' : 'left');

  return (
    <div
      data-resource-floating-panel
      data-testid={props['data-testid']}
      data-width-profile={profile()}
      data-panel-anchor={anchor()}
      class={cn(shellClass(), 'flex min-h-0 min-w-0 flex-col', props.class)}
      style={panelStyle()}
    >
      <div
        class={cn(
          'workbench-panel-resize-handle group pointer-events-none absolute z-1 top-0 bottom-0 w-12 touch-none',
          resizeHandleSide() === 'left' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2',
          resizing() ? 'workbench-panel-resize-handle--dragging' : '',
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
            'absolute top-0 bottom-0 w-2 cursor-col-resize rounded-full bg-transparent transition-colors pointer-events-auto group-hover:bg-sidebar-resize-handle-hover group-focus-visible:bg-sidebar-resize-handle-hover',
            resizeHandleSide() === 'left' ? 'left-5' : 'right-5',
          )}
          onPointerDown={startResize}
        />
      </div>
      {props.children}
    </div>
  );
}
