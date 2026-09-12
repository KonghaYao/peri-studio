import { DecisionQueueShell } from '@peri/ui';
import { Show } from 'solid-js';
import type { PendingPermission } from '@/entities/chat/control-view';
import { createIdentitySelection } from '@/features/message/identity-selection';
import type { PermissionDecisionState } from '@/features/message/permission-delivery';
import { PermissionRequestCard } from './PermissionRequestCard';

export interface PermissionQueueProps {
  permissions: PendingPermission[];
  decisions: Map<string, PermissionDecisionState>;
  readOnly: boolean;
  onResolve: (permissionId: string, decision: 'allow' | 'deny', optionId?: string) => void;
  onRetry?: (commandId: string) => void;
}

/** 一次聚焦一个安全裁决；使用投影外层身份，避免无关 Yjs 更新静默换题。 */
export function PermissionQueue(props: PermissionQueueProps) {
  const selection = createIdentitySelection(() => props.permissions, (item) => item.queueKey);

  return (
    <Show when={selection.current()}>
      {(permission) => {
        const permissionId = () => permission().permissionId;
        return (
          <DecisionQueueShell
            element="aside"
            class="chat-column pb-10"
            data-testid="permission-queue"
            surfaceTestId="permission-queue-surface"
            aria-label={`Pending permission requests, ${props.permissions.length} total`}
          >
            <PermissionRequestCard
              permission={permission()}
              decision={permissionId() ? props.decisions.get(permissionId()!) : undefined}
              readOnly={props.readOnly}
              currentIndex={selection.index()}
              total={props.permissions.length}
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
