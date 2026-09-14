import { GitChangeActions, GitChangeTree as GitChangeTreeBase } from '@peri/ui';
import { read, type MaybeAccessor } from '@/shared/lib/maybe-accessor';
import { resourceWorkspace } from '@/store';
import type { GitChange, GitChangeGroupId } from './types';

function ChangeRowActions(props: {
  change: GitChange;
  groupId: GitChangeGroupId;
  readOnly?: MaybeAccessor<boolean>;
  repoBusy?: MaybeAccessor<boolean>;
  onStageToggle?: (change: GitChange) => void;
  onDiscard?: (change: GitChange) => void;
}) {
  const mutation = () => resourceWorkspace().mutations?.[props.change.id];
  const busy = () => !!mutation()?.pending;
  const disabled = () => read(props.readOnly ?? false) || read(props.repoBusy ?? false) || busy();

  return (
    <GitChangeActions
      change={props.change}
      groupId={props.groupId}
      hoverGroup="tree-file"
      busy={busy()}
      disabled={disabled()}
      onStageToggle={() => props.onStageToggle?.(props.change)}
      onDiscard={() => props.onDiscard?.(props.change)}
    />
  );
}

/** SCM 变更树 T4 装配：mutation busy 与 focus 键注入 package T3。 */
export function GitChangeTree(props: {
  changes: GitChange[];
  groupId: GitChangeGroupId;
  repoId: string;
  onFileSelect?: (change: GitChange) => void;
  onStageToggle?: (change: GitChange) => void;
  onDiscard?: (change: GitChange) => void;
  readOnly?: MaybeAccessor<boolean>;
  repoBusy?: MaybeAccessor<boolean>;
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
      renderFileTrailing={(change) => (
        <ChangeRowActions
          change={change}
          groupId={props.groupId}
          readOnly={props.readOnly}
          repoBusy={props.repoBusy}
          onStageToggle={props.onStageToggle}
          onDiscard={props.onDiscard}
        />
      )}
    />
  );
}
