import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { SidebarProvider } from '@peri/ui';
import { ProjectSidebar } from '../../widgets/sidebar/ProjectSidebar';
import { ChatView } from '@/widgets/chat/ChatView';
import { compactViewportQuery, mediumViewportQuery } from '@/shared/lib/breakpoints';
import { ProjectDrawer } from './shared/ProjectDrawer';
import { ResourceWorkbench, type ResourcePreviewOrigin, type WorkbenchView } from '@/widgets/resource/ResourceWorkbench';
import { closeResourceDiffPreview, closeResourceFilePreview, resourceDiffPreview, resourceFilePreview } from '@/store';
import { resourceWorkbenchRequest } from '@/store';
import { ResourceDiffEditor } from '@/widgets/resource/ResourceDiffEditor';
import { ResourceFileEditor } from '@/widgets/resource/ResourceFileEditor';
import { ResourceFloatingPanel } from '@/widgets/resource/ResourceFloatingPanel';

import { workbenchFilePreviewLeftOffset } from '@/widgets/resource/resource-panel-layout';
import { SettingsDialog } from './SettingsDialog';
import {
  SHELL_SIDEBAR_DEFAULT_WIDTH,
  SHELL_SIDEBAR_KEYBOARD_STEP,
  SHELL_SIDEBAR_MAX_WIDTH,
  SHELL_SIDEBAR_MIN_WIDTH,
  clampShellSidebarWidth,
  shellSidebarColumnWidth,
} from './shell-sidebar-layout';

export function AppShell(props: { initialResourceView?: WorkbenchView } = {}) {
  const [open, setOpen] = createSignal(false);
  const [resourcesOpen, setResourcesOpen] = createSignal(false);
  const [systemOpen, setSystemOpen] = createSignal(false);
  const [resourceView, setResourceView] = createSignal<WorkbenchView>(props.initialResourceView ?? null);
  createEffect(() => {
    const request = resourceWorkbenchRequest();
    if (!request) return;
    setResourceView(request.view);
  });
  const [mobile, setMobile] = createSignal(false);
  const [medium, setMedium] = createSignal(false);
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [sidebarWidth, setSidebarWidth] = createSignal(SHELL_SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizing, setSidebarResizing] = createSignal(false);
  const [sidebarIntent, setSidebarIntent] = createSignal<{ kind: 'create-project' | 'import'; projectId?: string; nonce: number } | null>(null);
  let drawer: HTMLElement | undefined;
  let main: HTMLElement | undefined;
  let resourceFocusOrigin: ResourcePreviewOrigin | null = null;
  let restoreResourceFocus = false;
  let resourceViewBeforePreview: Exclude<WorkbenchView, null> | null = null;

  const setClampedSidebarWidth = (width: number) => setSidebarWidth(clampShellSidebarWidth(width));
  const stopSidebarResize = () => {
    window.removeEventListener('pointermove', resizeSidebar);
    window.removeEventListener('pointerup', stopSidebarResize);
    window.removeEventListener('pointercancel', stopSidebarResize);
    setSidebarResizing(false);
  };
  const resizeSidebar = (event: PointerEvent) => setClampedSidebarWidth(event.clientX);
  const startSidebarResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setSidebarResizing(true);
    window.addEventListener('pointermove', resizeSidebar);
    window.addEventListener('pointerup', stopSidebarResize);
    window.addEventListener('pointercancel', stopSidebarResize);
  };
  const resizeSidebarWithKeyboard = (event: KeyboardEvent) => {
    const step = event.shiftKey ? SHELL_SIDEBAR_KEYBOARD_STEP * 2 : SHELL_SIDEBAR_KEYBOARD_STEP;
    if (event.key === 'ArrowLeft') setClampedSidebarWidth(sidebarWidth() - step);
    else if (event.key === 'ArrowRight') setClampedSidebarWidth(sidebarWidth() + step);
    else if (event.key === 'Home') setClampedSidebarWidth(SHELL_SIDEBAR_MIN_WIDTH);
    else if (event.key === 'End') setClampedSidebarWidth(SHELL_SIDEBAR_MAX_WIDTH);
    else return;
    event.preventDefault();
  };

  onMount(() => {
    const query = window.matchMedia(compactViewportQuery);
    const mediumQuery = window.matchMedia(mediumViewportQuery);
    const sync = () => {
      setMobile(query.matches);
      setMedium(mediumQuery.matches);
      if (!query.matches) setOpen(false);
    };
    sync(); query.addEventListener('change', sync); mediumQuery.addEventListener('change', sync);
    onCleanup(() => {
      query.removeEventListener('change', sync);
      mediumQuery.removeEventListener('change', sync);
      stopSidebarResize();
    });
  });
  const openDrawer = () => {
    if (mobile()) setOpen(true);
    else queueMicrotask(() => drawer?.querySelector<HTMLElement>('.new-project-button:not(:disabled),.project-heading button:not(:disabled)')?.focus());
  };
  const requestSidebar = (kind: 'create-project' | 'import', projectId?: string) => {
    setSidebarIntent({ kind, projectId, nonce: Date.now() });
    if (mobile()) openDrawer();
  };
  const openWorkbench = (view: Exclude<WorkbenchView, null>) => {
    setOpen(false);
    setResourceView(view);
    if (mobile()) setResourcesOpen(true);
  };
  const openResources = () => openWorkbench(resourceView() ?? 'explorer');
  const focusPreviewEditor = () => {
    main?.querySelector<HTMLElement>('[data-resource-preview-focus]')?.focus();
  };
  const findResourceOrigin = (key: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-resource-focus-key]'))
    .find((element) => element.dataset.resourceFocusKey === key);
  const findResourceViewFallback = (view: ResourcePreviewOrigin['view']) => document
    .querySelector<HTMLElement>(`.ui-workbench-shell [aria-label="${view === 'explorer' ? 'Explorer' : 'Source Control'}"]`);
  const restorePreviewOrigin = (event: Event) => {
    if (!restoreResourceFocus || !resourceFocusOrigin) return;
    const origin = resourceFocusOrigin;
    const target = findResourceOrigin(origin.key);
    if (!target) {
      resourceFocusOrigin = null;
      restoreResourceFocus = false;
      return;
    }
    event.preventDefault();
    queueMicrotask(() => {
      if (target.isConnected) target.focus();
      resourceFocusOrigin = null;
      restoreResourceFocus = false;
    });
  };
  const overrideDialogFocusRestore = (event: Event) => {
    if (mobile() && resourceFocusOrigin && (resourceFilePreview() || resourceDiffPreview())) {
      // 先阻止默认恢复；微任务再等待 modal 清理完成后让编辑器接管。
      event.preventDefault();
      queueMicrotask(focusPreviewEditor);
    }
  };
  const closePreview = (kind: 'file' | 'diff') => {
    if (kind === 'file') closeResourceFilePreview();
    else closeResourceDiffPreview();
    if (!resourceFocusOrigin) return;
    if (mobile()) {
      restoreResourceFocus = true;
      setResourceView(resourceFocusOrigin.view);
      setResourcesOpen(true);
    } else {
      const origin = resourceFocusOrigin;
      queueMicrotask(() => {
        (findResourceOrigin(origin.key) ?? findResourceViewFallback(origin.view))?.focus();
        resourceFocusOrigin = null;
      });
    }
  };
  createEffect(() => {
    if (mobile() && (resourceFilePreview() || resourceDiffPreview())) setResourcesOpen(false);
  });
  createEffect(() => {
    if (mobile()) return;
    const diffOpen = !!resourceDiffPreview();
    const currentView = resourceView();
    if (diffOpen && currentView) {
      resourceViewBeforePreview = currentView;
      setResourceView(null);
      return;
    }
    if (!diffOpen && !currentView && resourceViewBeforePreview) {
      const restore = resourceViewBeforePreview;
      resourceViewBeforePreview = null;
      setResourceView(restore);
    }
  });
  const sidebarColumnWidth = () => shellSidebarColumnWidth(sidebarOpen(), sidebarWidth());
  const sidebarGridTemplate = () => mobile()
    ? 'minmax(0, 1fr)'
    : `${sidebarColumnWidth()}px minmax(0, 1fr) auto`;

  return (
    <SidebarProvider
      data-testid="app-shell"
      open={sidebarOpen()}
      onOpenChange={setSidebarOpen}
      class="group/sidebar-wrapper relative grid h-dvh grid-rows-fill overflow-hidden bg-app-bg grid-cols-shell desk:grid-cols-shell-desk wide:grid-cols-shell-wide"
      style={{
        '--sidebar-width': `${sidebarWidth()}px`,
        'grid-template-columns': sidebarGridTemplate(),
      }}
    >
      <ProjectDrawer ref={(element) => { drawer = element; }} open={open()} modal={mobile()} onOpenChange={setOpen}>
        <ProjectSidebar
          onNavigate={() => setOpen(false)}
          onOpenSystem={() => setSystemOpen(true)}
          intent={sidebarIntent()}
        />
      </ProjectDrawer>
      <Show when={!mobile() && sidebarOpen()}>
        <div
          class={`sidebar-resize-handle group pointer-events-none absolute z-35 top-0 bottom-0 w-12 -translate-x-1/2 touch-none ${sidebarResizing() ? 'sidebar-resize-handle--dragging' : ''}`}
          style={{ left: `${sidebarColumnWidth()}px` }}
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={SHELL_SIDEBAR_MIN_WIDTH}
          aria-valuemax={SHELL_SIDEBAR_MAX_WIDTH}
          aria-valuenow={sidebarWidth()}
          aria-valuetext={`${sidebarWidth()} pixels wide`}
          tabIndex={0}
          onKeyDown={resizeSidebarWithKeyboard}
        ><span
          aria-hidden="true"
          class="absolute top-0 bottom-0 left-5 w-2 cursor-col-resize rounded-full bg-transparent transition-colors pointer-events-auto group-hover:bg-sidebar-resize-handle-hover group-focus-visible:bg-sidebar-resize-handle-hover"
          onPointerDown={startSidebarResize}
        /></div>
      </Show>
      <main ref={main} data-testid="conversation-pane" class="flex min-w-0 min-h-0 flex-col overflow-hidden">
        <div class="min-h-0 flex-1">
          <Show when={resourceDiffPreview()} fallback={<ChatView onOpenNavigation={openDrawer} onOpenResources={openResources} onCreateProject={() => requestSidebar('create-project')} onImport={(projectId) => requestSidebar('import', projectId)} />}>
            <ResourceDiffEditor onClose={() => closePreview('diff')} />
          </Show>
        </div>
      </main>
      <Show when={resourceFilePreview()}>
        <ResourceFloatingPanel
          anchor="left"
          leftOffset={workbenchFilePreviewLeftOffset(mobile() ? 0 : sidebarColumnWidth())}
          widthProfile="preview"
          data-testid="resource-file-preview-panel"
        >
          <ResourceFileEditor onClose={() => closePreview('file')} />
        </ResourceFloatingPanel>
      </Show>
      <ResourceWorkbench
        compact={mobile()}
        autoCollapse={medium() && !mobile()}
        open={resourcesOpen()}
        onOpenChange={setResourcesOpen}
        view={resourceView()}
        onViewChange={setResourceView}
        onPreviewIntent={(origin) => { resourceFocusOrigin = origin; }}
        onCompactOpenAutoFocus={restorePreviewOrigin}
        onCompactCloseAutoFocus={overrideDialogFocusRestore}
      />
      <SettingsDialog open={systemOpen()} onClose={() => setSystemOpen(false)} />
    </SidebarProvider>
  );
}
