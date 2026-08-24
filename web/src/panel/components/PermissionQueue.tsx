import { Show } from 'solid-js';
import type { PendingPermission } from '../lib/control-view';
import { createIdentitySelection } from '../lib/identity-selection';
import type { PermissionDecisionState } from '../lib/permission-delivery';
import { Icon, IconButton } from '../../components/ui';
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

  return <Show when={selection.current()}>{(permission) => {
    const permissionId = () => permission().permissionId;
    return <aside class="permission-queue sticky top-12 z-10 mb-16" aria-label={`Pending permission requests, ${props.permissions.length} total`}>
      <Show when={props.permissions.length > 1}>
        <div class="permission-queue__navigation flex min-h-34 items-center justify-between gap-12 pt-5 pr-7 pb-5 pl-12 border border-border-subtle border-b-0 rounded-t-14 bg-surface text-text-secondary text-11 font-650 [&_[data-slot=button]]:min-h-28 [&_[data-slot=button]]:px-9">
          <span aria-live="polite">{selection.index() + 1} / {props.permissions.length}</span>
          <div class="flex gap-4">
            <IconButton label="Previous permission" class="size-28 min-h-28" disabled={selection.index() <= 0} onClick={() => selection.select(selection.index() - 1)}><Icon class="size-16!"><path d="m12.5 5-5 5 5 5" /></Icon></IconButton>
            <IconButton label="Next permission" class="size-28 min-h-28" disabled={selection.index() >= props.permissions.length - 1} onClick={() => selection.select(selection.index() + 1)}><Icon class="size-16!"><path d="m7.5 5 5 5-5 5" /></Icon></IconButton>
          </div>
        </div>
      </Show>
      <PermissionRequestCard
        permission={permission()}
        decision={permissionId() ? props.decisions.get(permissionId()!) : undefined}
        readOnly={props.readOnly}
        onResolve={(decision, optionId) => {
          const id = permissionId();
          if (id) props.onResolve(id, decision, optionId);
        }}
        onRetry={props.onRetry}
      />
    </aside>;
  }}</Show>;
}
