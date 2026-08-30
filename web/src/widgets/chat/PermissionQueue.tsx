import { Show } from 'solid-js';
import type { PendingPermission } from '@/entities/chat/control-view';
import { createIdentitySelection } from '../../panel/lib/identity-selection';
import type { PermissionDecisionState } from '../../panel/lib/permission-delivery';
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
          <aside
            class="permission-queue box-border w-full max-w-(--container-chat) mx-auto px-20 pb-10 desk:max-wide:max-w-(--container-chat-narrow) desk:max-wide:px-18 max-desk:max-w-(--container-chat-narrow) max-narrow:px-10"
            aria-label={`Pending permission requests, ${props.permissions.length} total`}
          >
            <div class="permission-queue__surface mb-12">
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
            </div>
          </aside>
        );
      }}
    </Show>
  );
}
