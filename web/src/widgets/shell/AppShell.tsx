import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { ProjectSidebar } from '../../widgets/sidebar/ProjectSidebar';
import { ChatView } from '@/widgets/chat/ChatView';
import { compactViewportQuery, mediumViewportQuery } from '../../panel/lib/breakpoints';
import { ProjectDrawer } from './shared/ProjectDrawer';
import { ResourceWorkbench, type ResourcePreviewOrigin, type WorkbenchView } from '@/widgets/resource/ResourceWorkbench';
import { closeResourceDiffPreview, closeResourceFilePreview, resourceDiffPreview, resourceFilePreview } from '../../panel/store';
import { resourceWorkbenchRequest } from '@/store';
import { ResourceDiffEditor } from '@/widgets/resource/ResourceDiffEditor';
import { ResourceFileEditor } from '@/widgets/resource/ResourceFileEditor';
import { ResourceFloatingPanel } from '@/widgets/resource/ResourceFloatingPanel';

import { workbenchFilePreviewLeftOffset } from '@/widgets/resource/resource-panel-layout';
import { SettingsDialog } from './SettingsDialog';

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 242;
const SIDEBAR_KEYBOARD_STEP = 24;

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

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
  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizing, setSidebarResizing] = createSignal(false);
  const [sidebarIntent, setSidebarIntent] = createSignal<{ kind: 'create-project' | 'import'; projectId?: string; nonce: number } | null>(null);
  let drawer: HTMLElement | undefined;
  let main: HTMLElement | undefined;
  let resourceFocusOrigin: ResourcePreviewOrigin | null = null;
  let restoreResourceFocus = false;
  let resourceViewBeforePreview: Exclude<WorkbenchView, null> | null = null;

  const setClampedSidebarWidth = (width: number) => setSidebarWidth(clampSidebarWidth(width));
  const stopSidebarResize = () => {
    window.removeEventListener('pointermove', resizeSidebar);
    window.removeEventListener('pointerup', stopSidebarResize);
    window.removeEventListener('pointercancel', stopSidebarResize);
    document.body.classList.remove('sidebar-resizing');
    setSidebarResizing(false);
  };
  const resizeSidebar = (event: PointerEvent) => setClampedSidebarWidth(event.clientX);
  const startSidebarResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    document.body.classList.add('sidebar-resizing');
    setSidebarResizing(true);
    window.addEventListener('pointermove', resizeSidebar);
    window.addEventListener('pointerup', stopSidebarResize);
    window.addEventListener('pointercancel', stopSidebarResize);
  };
  const resizeSidebarWithKeyboard = (event: KeyboardEvent) => {
    const step = event.shiftKey ? SIDEBAR_KEYBOARD_STEP * 2 : SIDEBAR_KEYBOARD_STEP;
    if (event.key === 'ArrowLeft') setClampedSidebarWidth(sidebarWidth() - step);
    else if (event.key === 'ArrowRight') setClampedSidebarWidth(sidebarWidth() + step);
    else if (event.key === 'Home') setClampedSidebarWidth(SIDEBAR_MIN_WIDTH);
    else if (event.key === 'End') setClampedSidebarWidth(SIDEBAR_MAX_WIDTH);
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
    .querySelector<HTMLElement>(`.resource-workbench [aria-label="${view === 'explorer' ? 'Explorer' : 'Source Control'}"]`);
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
  const sidebarGridTemplate = () => mobile()
    ? 'minmax(0, 1fr)'
    : `${sidebarWidth()}px minmax(0, 1fr) auto`;

  return (
    <div data-testid="app-shell" class="app-shell relative grid h-dvh grid-rows-fill overflow-hidden bg-app-bg grid-cols-shell desk:grid-cols-shell-desk wide:grid-cols-shell-wide" style={{ 'grid-template-columns': sidebarGridTemplate() }}>
      <ProjectDrawer ref={(element) => { drawer = element; }} open={open()} modal={mobile()} onOpenChange={setOpen}>
        <ProjectSidebar
          onNavigate={() => setOpen(false)}
          onOpenSystem={() => setSystemOpen(true)}
          intent={sidebarIntent()}
        />
      </ProjectDrawer>
      <div
        class={`sidebar-resize-handle group pointer-events-none absolute z-35 top-0 bottom-0 w-12 -translate-x-1/2 touch-none max-desk:hidden ${sidebarResizing() ? 'sidebar-resize-handle--dragging' : ''}`}
        style={{ left: `${sidebarWidth()}px` }}
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth()}
        aria-valuetext={`${sidebarWidth()} pixels wide`}
        tabIndex={0}
        onKeyDown={resizeSidebarWithKeyboard}
      ><span
        aria-hidden="true"
        class="absolute top-0 bottom-0 left-5 w-2 cursor-col-resize rounded-full bg-transparent transition-colors pointer-events-auto group-hover:bg-sidebar-resize-handle-hover group-focus-visible:bg-sidebar-resize-handle-hover"
        onPointerDown={startSidebarResize}
      /></div>
      <main ref={main} data-testid="conversation-pane" class="conversation-pane flex min-w-0 min-h-0 flex-col overflow-hidden">
        <div class="min-h-0 flex-1">
          <Show
            when={mobile() && resourceFilePreview()}
            fallback={
              <Show when={resourceDiffPreview()} fallback={<ChatView onOpenNavigation={openDrawer} onOpenResources={openResources} onCreateProject={() => requestSidebar('create-project')} onImport={(projectId) => requestSidebar('import', projectId)} />}>
                <ResourceDiffEditor onClose={() => closePreview('diff')} />
              </Show>
            }
          >
            <ResourceFileEditor onClose={() => closePreview('file')} />
          </Show>
        </div>
      </main>
      <Show when={!mobile() && resourceFilePreview()}>
        <ResourceFloatingPanel
          anchor="left"
          leftOffset={workbenchFilePreviewLeftOffset(sidebarWidth())}
          widthProfile="preview"
          data-testid="resource-file-preview-panel"
        >
          <ResourceFileEditor floating onClose={() => closePreview('file')} />
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
    </div>
  );
}
