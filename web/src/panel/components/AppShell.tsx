import { createSignal, onCleanup, onMount } from 'solid-js';
import { ProjectSidebar } from './ProjectSidebar';
import { ChatView } from './ChatView';
import { compactViewportQuery, Drawer } from '../../ui';
import { SettingsDialog } from './SettingsDialog';

export function AppShell() {
  const [open, setOpen] = createSignal(false);
  const [systemOpen, setSystemOpen] = createSignal(false);
  const [mobile, setMobile] = createSignal(false);
  const [sidebarIntent, setSidebarIntent] = createSignal<{ kind: 'create-project' | 'import'; projectId?: string; nonce: number } | null>(null);
  let drawer: HTMLElement | undefined;
  let main: HTMLElement | undefined;
  onMount(() => {
    const query = window.matchMedia(compactViewportQuery);
    const sync = () => {
      setMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    sync(); query.addEventListener('change', sync);
    onCleanup(() => query.removeEventListener('change', sync));
  });
  const openDrawer = () => {
    if (mobile()) setOpen(true);
    else queueMicrotask(() => drawer?.querySelector<HTMLElement>('.project-heading button:not(:disabled),.new-project-button:not(:disabled)')?.focus());
  };
  const requestSidebar = (kind: 'create-project' | 'import', projectId?: string) => {
    setSidebarIntent({ kind, projectId, nonce: Date.now() });
    if (mobile()) openDrawer();
  };
  return (
    <div class="app-shell grid h-dvh overflow-hidden bg-app-bg grid-cols-shell desk:grid-cols-shell-desk wide:grid-cols-shell-wide">
      <Drawer ref={(element) => { drawer = element; }} class="project-drawer min-w-0 border-r border-border-subtle bg-sidebar-bg max-desk:fixed max-desk:inset-y-0 max-desk:left-0 max-desk:z-40 max-desk:w-(--container-drawer) max-desk:-translate-x-full max-desk:transition-transform max-desk:duration-180 max-desk:ease-out" open={open()} modal={mobile()} label="Projects & Sessions" background={() => main} onClose={() => setOpen(false)}>
        <ProjectSidebar onNavigate={() => setOpen(false)} onOpenSystem={() => setSystemOpen(true)} intent={sidebarIntent()} />
      </Drawer>
      <main ref={main} class="conversation-pane min-w-0 min-h-0 overflow-hidden">
        <ChatView onOpenNavigation={openDrawer} onOpenSystem={() => setSystemOpen(true)} onCreateProject={() => requestSidebar('create-project')} onImport={(projectId) => requestSidebar('import', projectId)} />
      </main>
      <SettingsDialog open={systemOpen()} onClose={() => setSystemOpen(false)} />
    </div>
  );
}
