import { For, Show } from 'solid-js';
import { Pin } from 'lucide-solid';
import { SectionHeader } from '@peri/ui';
import { ProjectSidebarRow } from './project-sidebar-row';
import type { ProjectSidebarModel } from './project-sidebar-model';

export interface ProjectSidebarPinnedProps {
  model: ProjectSidebarModel;
  onNavigate?: () => void;
}

/** Pinned 是跨项目的扁平列表；左缩进与 Workspaces 会话行对齐。 */
export function ProjectSidebarPinned(props: ProjectSidebarPinnedProps) {
  const { model } = props;
  return (
    <Show when={model.pinnedSessions().length > 0}>
      <SectionHeader title="Pinned" icon={<Pin size={14} strokeWidth={1.7} />} />
      <div data-testid="pinned-list" class="flex flex-col gap-2 pb-1">
        <For each={model.pinnedSessions().map((session) => session.id)}>
          {(sessionId) => {
            const session = () => model.pinnedSessions().find((item) => item.id === sessionId)!;
            return (
              <ProjectSidebarRow
                model={model}
                session={session()}
                projectId={session().projectId}
                options={{ pinned: true, indent: 16 }}
                onNavigate={props.onNavigate}
              />
            );
          }}
        </For>
      </div>
    </Show>
  );
}
