import { DropdownMenuItem } from '@/shared/ui';
import { MessageSquarePlus, Search } from 'lucide-solid';
import { Show } from 'solid-js';
import { NavAction, SidebarNavBar } from './sidebar-parts';
import { ArchiveIcon } from './project-sidebar-icons';
import type { ProjectSidebarModel } from './project-sidebar-model';

export function ProjectSidebarNav(props: { model: ProjectSidebarModel }) {
  const { model } = props;
  return (
    <SidebarNavBar
      more={(
        <DropdownMenuItem onSelect={() => model.setArchivedBrowserGlobalOpen(true)}>
          <ArchiveIcon />
          Archived
          <Show when={model.archivedEntryCount() > 0}>
            <span class="ml-auto text-11 text-content-muted">{model.archivedEntryCount()}</span>
          </Show>
        </DropdownMenuItem>
      )}
    >
      <NavAction icon={<MessageSquarePlus size={16} strokeWidth={1.7} />} label="New session" disabled={model.readOnly()} onClick={model.handleNewSession} />
      <NavAction icon={<Search size={16} strokeWidth={1.7} />} label="Search" onClick={() => model.setSearchOpen(true)} />
    </SidebarNavBar>
  );
}
