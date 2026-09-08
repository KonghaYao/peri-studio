import { Show } from 'solid-js';
import { readOnly } from '../../panel/lib/auth-state';
import { SessionSearch } from './SessionSearch';
import { SidebarChrome } from '@/widgets/shell/SidebarChrome';
import { createProjectSidebarModel, type ProjectSidebarIntent } from './project-sidebar-model';
import { ProjectSidebarNav } from './project-sidebar-nav';
import { ProjectSidebarTree } from './project-sidebar-tree';
import { ProjectSidebarArchive } from './project-sidebar-archive';
import { ProjectSidebarRemoteDir } from './project-sidebar-remote-dir';

export type { ProjectSidebarIntent };

interface ProjectSidebarProps {
  onNavigate?: () => void;
  onOpenSystem?: () => void;
  intent?: ProjectSidebarIntent | null;
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const model = createProjectSidebarModel(() => props.intent);

  return (
    <SidebarChrome
      onOpenSystem={props.onOpenSystem}
      nav={<ProjectSidebarNav model={model} />}
    >
      <SessionSearch open={model.searchOpen()} onClose={() => model.setSearchOpen(false)} onSelected={props.onNavigate} />
      <ProjectSidebarArchive model={model} />
      <Show when={readOnly()}><div class="readonly-label px-2.5 pb-2 text-11 font-semibold text-warning">Read-only mode</div></Show>
      <ProjectSidebarRemoteDir model={model} />
      <ProjectSidebarTree model={model} onNavigate={props.onNavigate} />
    </SidebarChrome>
  );
}
