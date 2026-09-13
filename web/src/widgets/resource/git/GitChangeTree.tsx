import { GitChangeActions, GitChangeTree as GitChangeTreeBase } from '@peri/ui';
import { resourceWorkspace } from '@/store';
import type { GitChange, GitChangeGroupId } from './types';

/** SCM 变更树 T4 装配：mutation busy 与 focus 键注入 package T3。 */
export function GitChangeTree(props: {
  changes: GitChange[];
  groupId: GitChangeGroupId;
  repoId: string;
  onFileSelect?: (change: GitChange) => void;
  onStageToggle?: (change: GitChange) => void;
  onDiscard?: (change: GitChange) => void;
  readOnly?: boolean;
  repoBusy?: boolean;
}) {
  return (
    <GitChangeTreeBase
      changes={props.changes}
      groupId={props.groupId}
      fileTreeitem={false}
      onFileSelect={props.onFileSelect}
      getFileDataAttrs={(change) => ({
        'data-resource-focus-key': `file:${change.path}`,
        'data-resource-focus-view': 'scm',
      })}
      fileAriaLabel={(change) => `Open changes for ${change.path}`}
      renderFileTrailing={(change) => {
        const mutation = () => resourceWorkspace().mutations?.[change.id];
        const busy = () => !!mutation()?.pending;
        const disabled = () => props.readOnly || props.repoBusy || busy();

        return (
          <GitChangeActions
            change={change}
            groupId={props.groupId}
            hoverGroup="tree-file"
            busy={busy()}
            disabled={disabled()}
            onStageToggle={() => props.onStageToggle?.(change)}
            onDiscard={() => props.onDiscard?.(change)}
          />
        );
      }}
    />
  );
}
