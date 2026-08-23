import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { ProjectSidebar } from './ProjectSidebar';
import { ChatView } from './ChatView';
import { compactViewportQuery, mediumViewportQuery } from '../lib/breakpoints';
import { ProjectDrawer } from './shared/ProjectDrawer';
import { SettingsDialog } from './SettingsDialog';
import { ResourceWorkbench, type WorkbenchView } from './ResourceWorkbench';
import { resourceDiffPreview, resourceFilePreview } from '../store';
import { ResourceDiffEditor } from './ResourceDiffEditor';
import { ResourceFileEditor } from './ResourceFileEditor';
import { WorkbenchStatusBar } from './WorkbenchStatusBar';

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 242;
const SIDEBAR_KEYBOARD_STEP = 24;

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

export function AppShell() {
  const [open, setOpen] = createSignal(false);
  const [systemOpen, setSystemOpen] = createSignal(false);
  const [resourcesOpen, setResourcesOpen] = createSignal(false);
  const [resourceView, setResourceView] = createSignal<WorkbenchView>('explorer');
  const [mobile, setMobile] = createSignal(false);
  const [medium, setMedium] = createSignal(false);
  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizing, setSidebarResizing] = createSignal(false);
  const [sidebarIntent, setSidebarIntent] = createSignal<{ kind: 'create-project' | 'import'; projectId?: string; nonce: number } | null>(null);
  let drawer: HTMLElement | undefined;
  let main: HTMLElement | undefined;

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
  const openResources = () => {
    setOpen(false);
    setResourceView('explorer');
    if (mobile()) setResourcesOpen(true);
  };
  createEffect(() => {
    if (mobile() && (resourceFilePreview() || resourceDiffPreview())) setResourcesOpen(false);
  });
  const sidebarGridTemplate = () => mobile()
    ? 'minmax(0, 1fr)'
    : `${sidebarWidth()}px auto minmax(0, 1fr)`;

  return (
    <div class="app-shell relative grid h-dvh grid-rows-[minmax(0,1fr)_22px] overflow-hidden bg-app-bg grid-cols-shell desk:grid-cols-shell-desk wide:grid-cols-shell-wide pointer-coarse:grid-rows-[minmax(0,1fr)_44px]" style={{ 'grid-template-columns': sidebarGridTemplate() }}>
      <ProjectDrawer ref={(element) => { drawer = element; }} open={open()} modal={mobile()} onOpenChange={setOpen}>
        <ProjectSidebar
          onNavigate={() => setOpen(false)}
          onOpenSystem={() => setSystemOpen(true)}
          intent={sidebarIntent()}
        />
      </ProjectDrawer>
      <div
        class={`sidebar-resize-handle group absolute z-35 top-0 bottom-0 w-12 -translate-x-1/2 cursor-col-resize touch-none max-desk:hidden ${sidebarResizing() ? 'select-none [&_*]:cursor-col-resize!' : ''}`}
        style={{ left: `${sidebarWidth()}px` }}
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth()}
        aria-valuetext={`${sidebarWidth()} pixels wide`}
        tabIndex={0}
        onPointerDown={startSidebarResize}
        onKeyDown={resizeSidebarWithKeyboard}
      ><span aria-hidden="true" class="absolute top-0 bottom-0 left-5 w-2 rounded-full bg-transparent transition-colors group-hover:bg-accent group-focus-visible:bg-accent" /></div>
      <ResourceWorkbench compact={mobile()} overlay={medium() && !mobile()} open={resourcesOpen()} onOpenChange={setResourcesOpen} view={resourceView()} onViewChange={setResourceView} />
      <main ref={main} class="conversation-pane min-w-0 min-h-0 overflow-hidden">
        <Show when={resourceFilePreview()} fallback={<Show when={resourceDiffPreview()} fallback={<ChatView onOpenNavigation={openDrawer} onOpenSystem={() => setSystemOpen(true)} onCreateProject={() => requestSidebar('create-project')} onImport={(projectId) => requestSidebar('import', projectId)} />}>
          <ResourceDiffEditor />
        </Show>}>
          <ResourceFileEditor />
        </Show>
      </main>
      <WorkbenchStatusBar onOpenResources={openResources} />
      <SettingsDialog open={systemOpen()} onClose={() => setSystemOpen(false)} />
    </div>
  );
}
