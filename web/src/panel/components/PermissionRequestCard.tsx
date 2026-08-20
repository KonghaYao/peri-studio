import { createUniqueId, Show } from 'solid-js';
import type { PendingPermission } from '../lib/control-view';
import type { PermissionDecisionState } from '../lib/permission-delivery';
import { Button } from '../../components/ui';

function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return '';
  return id.length > length ? `${id.slice(0, length)}…` : id;
}

export interface PermissionRequestCardProps {
  permission: PendingPermission;
  decision?: PermissionDecisionState;
  readOnly: boolean;
  onResolve: (decision: 'allow' | 'deny') => void;
  onRetry?: (commandId: string) => void;
}

/** A security decision surface. The server projection owns its lifetime; the
 * card only renders known facts and prevents a second, conflicting decision. */
export function PermissionRequestCard(props: PermissionRequestCardProps) {
  const domId = createUniqueId();
  const actionable = () => !!props.permission.permissionId;
  const locked = () => !!props.decision;
  const uncertain = () => props.decision?.phase === 'uncertain';
  const retryable = () => uncertain() && props.decision?.retryable === true;
  const action = () => props.decision?.decision === 'allow' ? 'Allow' : 'Deny';
  const statusId = `permission-status-${domId}`;

  return <section
    class={`permission-request ${uncertain() ? 'permission-request--uncertain' : ''} grid grid-cols-permission gap-12 items-start m-0 p-14 border rounded-16 bg-warning-soft max-middle:grid-cols-[24px_minmax(0,1fr)] max-middle:p-12 ${uncertain() ? 'border-warning shadow-none' : 'border-warning-border shadow-recovery'}`}
    aria-labelledby={`${statusId}-title`}
    aria-describedby={statusId}
    aria-busy={locked() && !uncertain() ? 'true' : undefined}
  >
    <div class="permission-request__mark grid size-28 place-items-center rounded-full bg-warning text-surface text-13 font-750 max-middle:size-24" aria-hidden="true">!</div>
    <div class="permission-request__body min-w-0">
      <span class="permission-request__eyebrow block mb-3 text-warning text-10 font-750 tracking-6 uppercase">Permission needed</span>
      <strong class="block text-text-primary text-14" id={`${statusId}-title`}>{props.permission.title || 'Permission request'}</strong>
      <Show when={props.permission.description}><p class="mt-4 text-text-secondary text-13 leading-15">{props.permission.description}</p></Show>
      <Show when={props.permission.toolCallId}><code class="block w-max max-w-full mt-7 overflow-hidden text-text-secondary font-mono text-10 leading-14 text-ellipsis whitespace-nowrap" title={props.permission.toolCallId || undefined}>tool {shortId(props.permission.toolCallId)}</code></Show>
      <div id={statusId} class={`permission-request__status mt-8 text-11 leading-145 ${uncertain() ? 'text-warning font-semibold' : 'text-text-secondary'}`} role={uncertain() ? 'alert' : 'status'} aria-live="polite">
        <Show when={uncertain()} fallback={locked() ? `${action()}ing…` : !actionable() ? 'The request lacks a permission marker; submission was blocked. Wait for the server to re-sync.' : props.readOnly ? 'Read-only mode cannot handle this request.' : 'Locks immediately once selected to avoid submitting an opposite decision.'}>
          {retryable()
            ? `${action()} not delivered yet. Re-confirm with the original request; no second decision is created.`
            : `${action()} outcome not confirmed yet. To avoid executing the opposite decision, wait for the request to disappear or a clear error.`}
        </Show>
      </div>
    </div>
    <div class="permission-request__actions flex gap-7 self-center max-middle:col-span-full max-middle:w-full max-middle:pt-2 max-middle:[&_[data-slot=button]]:flex-1 max-middle:[&_[data-slot=button]]:min-h-44 pointer-coarse:[&_[data-slot=button]]:min-h-44">
      <Button variant="primary" class="min-w-72" disabled={props.readOnly || locked() || !actionable()} busy={props.decision?.phase === 'pending' && props.decision.decision === 'allow'} onClick={() => actionable() && props.onResolve('allow')}>
        {props.decision?.decision === 'allow' ? 'Allowing…' : 'Allow'}
      </Button>
      <Button variant="secondary" class="min-w-72" disabled={props.readOnly || locked() || !actionable()} busy={props.decision?.phase === 'pending' && props.decision.decision === 'deny'} onClick={() => actionable() && props.onResolve('deny')}>
        {props.decision?.decision === 'deny' ? 'Denying…' : 'Deny'}
      </Button>
      <Show when={retryable() && props.decision}>
        {(decision) => <Button variant="primary" class="min-w-72" disabled={props.readOnly} onClick={() => props.onRetry?.(decision().commandId)}>Retry with original request</Button>}
      </Show>
    </div>
  </section>;
}
