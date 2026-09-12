import { MessageSquarePlus, Search } from 'lucide-solid';
import { NavAction, SidebarNavBar } from '@peri/ui';
import { ArchiveIcon } from './project-sidebar-icons';
import type { ProjectSidebarModel } from './project-sidebar-model';

export function ProjectSidebarNav(props: { model: ProjectSidebarModel }) {
  const { model } = props;
  const archivedCount = () => model.archivedEntryCount();
  return (
    <SidebarNavBar
      menuItems={[{
        id: 'archived',
        label: 'Archived',
        icon: <ArchiveIcon />,
        suffix: archivedCount() > 0 ? String(archivedCount()) : undefined,
      }]}
      onMenuSelect={(id) => {
        if (id === 'archived') model.setArchivedBrowserGlobalOpen(true);
      }}
    >
      <NavAction icon={<MessageSquarePlus size={16} strokeWidth={1.7} />} label="New session" disabled={model.readOnly()} onClick={model.handleNewSession} />
      <NavAction icon={<Search size={16} strokeWidth={1.7} />} label="Search" onClick={() => model.setSearchOpen(true)} />
    </SidebarNavBar>
  );
}
