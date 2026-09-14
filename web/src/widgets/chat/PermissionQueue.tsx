import { DecisionQueueShell, chatColumnClass } from '@peri/ui';
import { read, type MaybeAccessor } from '@/shared/lib/maybe-accessor';
import { Show } from 'solid-js';
import type { PendingPermission } from '@/entities/chat/control-view';
import { createIdentitySelection } from '@/features/message/identity-selection';
import type { PermissionDecisionState } from '@/features/message/permission-delivery';
import { PermissionRequestCard } from './PermissionRequestCard';

export interface PermissionQueueProps {
  permissions: MaybeAccessor<PendingPermission[]>;
  decisions: MaybeAccessor<Map<string, PermissionDecisionState>>;
  readOnly: MaybeAccessor<boolean>;
  onResolve: (permissionId: string, decision: 'allow' | 'deny', optionId?: string) => void;
  onRetry?: (commandId: string) => void;
}

/** 一次聚焦一个安全裁决；使用投影外层身份，避免无关 Yjs 更新静默换题。 */
export function PermissionQueue(props: PermissionQueueProps) {
  const permissions = () => read(props.permissions);
  const decisions = () => read(props.decisions);
  const readOnly = () => read(props.readOnly);
  const selection = createIdentitySelection(permissions, (item) => item.queueKey);

  return (
    <Show when={selection.current()}>
      {(permission) => {
        const permissionId = () => permission().permissionId;
        return (
          <DecisionQueueShell
            element="aside"
            class={`${chatColumnClass} pb-10`}
            data-testid="permission-queue"
            surfaceTestId="permission-queue-surface"
            aria-label={`Pending permission requests, ${permissions().length} total`}
          >
            <PermissionRequestCard
              permission={permission}
              decision={() => (permissionId() ? decisions().get(permissionId()!) : undefined)}
              readOnly={readOnly}
              currentIndex={selection.index}
              total={() => permissions().length}
              onPrevious={() => selection.select(selection.index() - 1)}
              onNext={() => selection.select(selection.index() + 1)}
              onResolve={(decision, optionId) => {
                const id = permissionId();
                if (id) props.onResolve(id, decision, optionId);
              }}
              onRetry={props.onRetry}
            />
          </DecisionQueueShell>
        );
      }}
    </Show>
  );
}
