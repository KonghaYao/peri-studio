import { type JSX, createEffect, createSignal, onCleanup } from 'solid-js';
import {
  WORKBENCH_PANEL_KEYBOARD_STEP,
  RESOURCE_PANEL_FLOATING_SHELL_CLASS,
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
  /** workspace = Explorer/SCM/MCP；graph = Git Graph（更宽默认与上下限）。 */
  widthProfile?: WorkbenchPanelWidthProfile;
};

/** 桌面端 Explorer / SCM / Graph 共用的右侧浮动面板壳（可拖拽左缘调宽）。 */
export function ResourceFloatingPanel(props: ResourceFloatingPanelProps) {
  const profile = () => props.widthProfile ?? 'workspace';
  const limits = () => workbenchPanelWidthLimits(profile());

  const [width, setWidth] = createSignal(readStoredWorkbenchPanelWidth(profile()));
  const [resizing, setResizing] = createSignal(false);
  let panelRight = 0;

  createEffect(() => {
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
    setClampedWidth(panelRight - event.clientX);
  };

  const startResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const panel = (event.currentTarget as HTMLElement).closest('[data-resource-floating-panel]');
    if (panel) panelRight = panel.getBoundingClientRect().right;
    document.body.classList.add('workbench-panel-resizing');
    setResizing(true);
    window.addEventListener('pointermove', resizeWithPointer);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  const resizeWithKeyboard = (event: KeyboardEvent) => {
    const { minWidth, maxWidth } = limits();
    const step = event.shiftKey ? WORKBENCH_PANEL_KEYBOARD_STEP * 2 : WORKBENCH_PANEL_KEYBOARD_STEP;
    if (event.key === 'ArrowLeft') setClampedWidth(width() + step);
    else if (event.key === 'ArrowRight') setClampedWidth(width() - step);
    else if (event.key === 'Home') setClampedWidth(minWidth);
    else if (event.key === 'End') setClampedWidth(maxWidth);
    else return;
    event.preventDefault();
  };

  onCleanup(stopResize);

  return (
    <div
      data-resource-floating-panel
      data-testid={props['data-testid']}
      data-width-profile={profile()}
      class={`${RESOURCE_PANEL_FLOATING_SHELL_CLASS} flex min-h-0 min-w-0 flex-col ${props.class ?? ''}`}
      style={{ width: `${width()}px` }}
    >
      <div
        class={`workbench-panel-resize-handle group pointer-events-none absolute z-1 top-0 bottom-0 left-0 w-12 -translate-x-1/2 touch-none ${resizing() ? 'workbench-panel-resize-handle--dragging' : ''}`}
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
          class="absolute top-0 bottom-0 left-5 w-2 cursor-col-resize rounded-full bg-transparent transition-colors pointer-events-auto group-hover:bg-sidebar-resize-handle-hover group-focus-visible:bg-sidebar-resize-handle-hover"
          onPointerDown={startResize}
        />
      </div>
      {props.children}
    </div>
  );
}
