import { Show } from 'solid-js';
import type { PendingPermission } from '../lib/control-view';
import { createIdentitySelection } from '../lib/identity-selection';
import type { PermissionDecisionState } from '../lib/permission-delivery';
import { IconButton } from '../../components/ui';
import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-solid';
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
    return <aside class="permission-queue box-border w-full max-w-(--container-chat) mx-auto px-20 pb-10 desk:max-wide:max-w-(--container-chat-narrow) desk:max-wide:px-18 max-desk:max-w-(--container-chat-narrow) max-narrow:px-10" aria-label={`Pending permission requests, ${props.permissions.length} total`}>
      <section class="permission-queue__surface mb-12 overflow-hidden rounded-(--decision-radius) border border-border-subtle bg-surface shadow-float">
        <header class="permission-queue__header flex min-h-38 items-center gap-6 border-b border-divider px-12">
          <span class="text-11 font-650 text-text-secondary">Permissions</span>
          <Show when={props.permissions.length > 1}>
            <span class="flex items-center gap-1 text-text-muted text-10 tabular-nums">
              <IconButton label="Previous permission" variant="ghost" size="compact" class="size-24 min-h-24 border-0 bg-transparent text-text-muted disabled:opacity-30" disabled={selection.index() <= 0} onClick={() => selection.select(selection.index() - 1)}><ChevronLeft size={13} strokeWidth={1.8} /></IconButton>
              <span class="min-w-26 text-center text-9" aria-live="polite">{selection.index() + 1} / {props.permissions.length}</span>
              <IconButton label="Next permission" variant="ghost" size="compact" class="size-24 min-h-24 border-0 bg-transparent text-text-muted disabled:opacity-30" disabled={selection.index() >= props.permissions.length - 1} onClick={() => selection.select(selection.index() + 1)}><ChevronRight size={13} strokeWidth={1.8} /></IconButton>
            </span>
          </Show>
          <ShieldCheck size={14} strokeWidth={1.8} class="ml-auto text-warning" aria-hidden="true" />
        </header>
        <PermissionRequestCard
          embedded
          permission={permission()}
          decision={permissionId() ? props.decisions.get(permissionId()!) : undefined}
          readOnly={props.readOnly}
          onResolve={(decision, optionId) => {
            const id = permissionId();
            if (id) props.onResolve(id, decision, optionId);
          }}
          onRetry={props.onRetry}
        />
      </section>
    </aside>;
  }}</Show>;
}
