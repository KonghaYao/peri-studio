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
  const status = () => {
    if (uncertain()) return retryable() ? `${action()} not confirmed · Retry available` : `${action()} not confirmed`;
    if (locked()) return `${action()}ing…`;
    if (!actionable()) return 'Unavailable';
    if (props.readOnly) return 'Read only';
    return '';
  };
  const statusId = `permission-status-${domId}`;

  return <section
    class={`permission-request ${uncertain() ? 'permission-request--uncertain' : ''} grid grid-cols-permission gap-12 items-start m-0 p-14 border rounded-16 bg-surface max-middle:grid-cols-[24px_minmax(0,1fr)] max-middle:p-12 ${uncertain() ? 'border-warning shadow-none' : 'border-border-subtle shadow-float'}`}
    aria-labelledby={`${statusId}-title`}
    aria-describedby={status() ? statusId : undefined}
    aria-busy={locked() && !uncertain() ? 'true' : undefined}
  >
    <div class="permission-request__mark grid size-24 place-items-center rounded-full border border-warning-border bg-surface text-warning text-12 font-750" aria-hidden="true">!</div>
    <div class="permission-request__body min-w-0">
      <span class="permission-request__eyebrow block mb-3 text-warning text-10 font-750 tracking-6 uppercase">Permission needed</span>
      <strong class="block text-text-primary text-14" id={`${statusId}-title`}>{props.permission.title || 'Permission request'}</strong>
      <Show when={props.permission.description}><p class="mt-4 text-text-secondary text-13 leading-15">{props.permission.description}</p></Show>
      <Show when={props.permission.toolCallId}><code class="sr-only" title={props.permission.toolCallId || undefined}>tool {shortId(props.permission.toolCallId)}</code></Show>
      <Show when={status()}><div id={statusId} class={`permission-request__status mt-7 text-11 leading-145 ${uncertain() ? 'text-warning font-semibold' : 'text-text-secondary'}`} role={uncertain() ? 'alert' : 'status'} aria-live="polite">{status()}</div></Show>
    </div>
    <div class="permission-request__actions flex justify-end gap-7 self-center max-middle:col-span-full max-middle:w-full max-middle:pt-2">
      <Button variant="primary" class="min-h-36! min-w-72 max-narrow:min-h-44!" disabled={props.readOnly || locked() || !actionable()} busy={props.decision?.phase === 'pending' && props.decision.decision === 'allow'} onClick={() => actionable() && props.onResolve('allow')}>
        {props.decision?.decision === 'allow' ? 'Allowing…' : 'Allow'}
      </Button>
      <Button variant="secondary" class="min-h-36! min-w-72 max-narrow:min-h-44!" disabled={props.readOnly || locked() || !actionable()} busy={props.decision?.phase === 'pending' && props.decision.decision === 'deny'} onClick={() => actionable() && props.onResolve('deny')}>
        {props.decision?.decision === 'deny' ? 'Denying…' : 'Deny'}
      </Button>
      <Show when={retryable() && props.decision}>
        {(decision) => <Button variant="primary" class="min-h-36! min-w-72 max-narrow:min-h-44!" disabled={props.readOnly} onClick={() => props.onRetry?.(decision().commandId)}>Retry with original request</Button>}
      </Show>
    </div>
  </section>;
}
