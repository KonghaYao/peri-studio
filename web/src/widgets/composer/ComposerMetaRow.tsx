import { GitBranch, Laptop } from 'lucide-solid';
import { Show, createMemo, type Component } from 'solid-js';
import { TokenUsageMeter, composerMetaChipClass } from '@peri/ui';
import {
  composerBranchLabel,
  composerMachineLabel,
  composerUsageMeterProps,
} from '@/features/composer/composer-meta';
import {
  chatHead,
  instances,
  machines,
  projectSessions,
  projects,
  resourceWorkspace,
  selectedSessionId,
} from '@/store';

/** T4 · Composer 底栏：分支、运行位置与 token 用量。 */
export const ComposerMetaRow: Component = () => {
  const activeProject = createMemo(() => {
    const session = projectSessions().find((row) => row.id === selectedSessionId());
    return projects().find((project) => project.id === session?.projectId) ?? null;
  });
  const branchLabel = createMemo(() => composerBranchLabel(resourceWorkspace().repositories));
  const machineLabel = createMemo(() => composerMachineLabel(activeProject(), instances(), machines()));
  const usageProps = createMemo(() => composerUsageMeterProps(chatHead()?.agent ?? null));

  return (
    <>
      <Show when={branchLabel()}>
        {(label) => (
          <span class={composerMetaChipClass} aria-label="Branch">
            <GitBranch size={12} strokeWidth={1.7} aria-hidden="true" />
            <span class="truncate">{label()}</span>
          </span>
        )}
      </Show>
      <Show when={machineLabel()}>
        {(label) => (
          <span class={composerMetaChipClass} aria-label="Runtime location">
            <Laptop size={12} strokeWidth={1.7} aria-hidden="true" />
            <span class="truncate">{label()}</span>
          </span>
        )}
      </Show>
      <span class="flex-1" aria-hidden="true" />
      <Show when={usageProps()}>
        {(props) => <TokenUsageMeter {...props()} />}
      </Show>
    </>
  );
};
