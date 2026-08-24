import { createEffect, createSignal, createUniqueId, onCleanup, Show } from 'solid-js';
import { parsePermissionExpiration, type PendingPermission } from '../lib/control-view';
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
  onResolve: (decision: 'allow' | 'deny', optionId?: string) => void;
  onRetry?: (commandId: string) => void;
}

/** A security decision surface. The server projection owns its lifetime; the
 * card only renders known facts and prevents a second, conflicting decision. */
export function PermissionRequestCard(props: PermissionRequestCardProps) {
  const domId = createUniqueId();
  const [now, setNow] = createSignal(Date.now());
  const [deadlineTick, setDeadlineTick] = createSignal(0);
  const expiresAt = () => {
    return parsePermissionExpiration(props.permission.expiresAt);
  };
  const invalidExpiration = () => {
    const value = expiresAt();
    return value !== null && !Number.isFinite(value);
  };
  const expired = () => {
    const value = expiresAt();
    return value !== null && Number.isFinite(value) && value <= now();
  };
  const expirationBlocked = () => invalidExpiration() || expired();
  createEffect(() => {
    deadlineTick();
    const value = expiresAt();
    const current = Date.now();
    setNow(current);
    if (value === null || !Number.isFinite(value) || value <= current) return;
    const remaining = value - current;
    const timer = window.setTimeout(
      () => setDeadlineTick((tick) => tick + 1),
      Math.min(remaining, remaining % 1_000 || 1_000),
    );
    onCleanup(() => window.clearTimeout(timer));
  });
  const deadlineLabel = () => {
    const value = expiresAt();
    if (value === null) return '';
    if (!Number.isFinite(value)) return 'Expiration unavailable';
    const remainingSeconds = Math.max(0, Math.ceil((value - now()) / 1_000));
    if (remainingSeconds === 0) return 'Expired';
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    return minutes ? `Expires in ${minutes}m ${seconds}s` : `Expires in ${seconds}s`;
  };
  const actionable = () => !!props.permission.permissionId && !expirationBlocked();
  const allowLabel = () => props.permission.options.includes('allowOnce')
    ? 'Allow once'
    : props.permission.options.includes('allowSession') ? 'Allow for this session' : null;
  const allowOptionId = () => props.permission.options.includes('allowOnce')
    ? props.permission.optionIds?.allowOnce
    : props.permission.optionIds?.allowSession;
  const hasDeny = () => props.permission.options.includes('deny');
  const exactOptionRequired = () => props.permission.optionIds !== undefined;
  const allowActionable = () => actionable() && (!exactOptionRequired() || !!allowOptionId());
  const denyActionable = () => actionable()
    && (!hasDeny() || !exactOptionRequired() || !!props.permission.optionIds?.deny);
  const locked = () => !!props.decision;
  const uncertain = () => props.decision?.phase === 'uncertain';
  const retryable = () => uncertain() && props.decision?.retryable === true;
  const action = () => props.decision?.decision === 'allow' ? 'Allow' : 'Deny';
  const status = () => {
    if (uncertain()) {
      if (expired()) return `${action()} not confirmed · Request expired`;
      if (invalidExpiration()) return `${action()} not confirmed · Expiration unavailable`;
      return retryable() ? `${action()} not confirmed · Retry available` : `${action()} not confirmed`;
    }
    if (locked()) return `${action()}ing…`;
    if (!actionable()) return 'Unavailable';
    if (props.readOnly) return 'Read only';
    if ((!!allowLabel() && !allowActionable()) || (hasDeny() && !denyActionable())) {
      return 'Some permission options unavailable';
    }
    return '';
  };
  const statusId = `permission-status-${domId}`;
  const deadlineId = `permission-deadline-${domId}`;
  const describedBy = () => [deadlineLabel() ? deadlineId : '', status() ? statusId : ''].filter(Boolean).join(' ') || undefined;

  return <section
    class={`permission-request ${uncertain() ? 'permission-request--uncertain' : ''} grid grid-cols-permission gap-12 items-start m-0 p-14 border rounded-16 bg-surface max-middle:grid-cols-[24px_minmax(0,1fr)] max-middle:p-12 ${uncertain() ? 'border-warning shadow-none' : 'border-border-subtle shadow-float'}`}
    aria-labelledby={`${statusId}-title`}
    aria-describedby={describedBy()}
    aria-busy={locked() && !uncertain() ? 'true' : undefined}
  >
    <div class="permission-request__mark grid size-24 place-items-center rounded-full border border-warning-border bg-surface text-warning text-12 font-750" aria-hidden="true">!</div>
    <div class="permission-request__body min-w-0">
      <strong class="block text-text-primary text-14" id={`${statusId}-title`}>{props.permission.title || 'Permission request'}</strong>
      <Show when={props.permission.description}><p class="mt-4 text-text-secondary text-13 leading-15">{props.permission.description}</p></Show>
      <Show when={props.permission.toolCallId}><code class="sr-only" title={props.permission.toolCallId || undefined}>tool {shortId(props.permission.toolCallId)}</code></Show>
      <Show when={deadlineLabel()}><div id={deadlineId} class={`mt-7 text-11 leading-145 ${expirationBlocked() ? 'text-warning font-semibold' : 'text-text-secondary'}`}>
        <time dateTime={props.permission.expiresAt || undefined}>{deadlineLabel()}</time>
      </div></Show>
      <Show when={status()}><div id={statusId} class={`permission-request__status mt-7 text-11 leading-145 ${uncertain() ? 'text-warning font-semibold' : 'text-text-secondary'}`} role={uncertain() ? 'alert' : 'status'} aria-live="polite">{status()}</div></Show>
    </div>
    <div class="permission-request__actions flex justify-end gap-7 self-center max-middle:col-span-full max-middle:w-full max-middle:pt-2">
      <Show when={allowLabel()}>{(label) => <Button variant="primary" class="min-h-36! min-w-72 max-narrow:min-h-44!" disabled={props.readOnly || locked() || !allowActionable()} busy={props.decision?.phase === 'pending' && props.decision.decision === 'allow'} onClick={() => allowActionable() && props.onResolve('allow', allowOptionId())}>
        {props.decision?.decision === 'allow' ? `${label()}…` : label()}
      </Button>}</Show>
      <Button variant="secondary" class="min-h-36! min-w-72 max-narrow:min-h-44!" disabled={props.readOnly || locked() || !denyActionable()} busy={props.decision?.phase === 'pending' && props.decision.decision === 'deny'} onClick={() => denyActionable() && props.onResolve('deny', props.permission.optionIds?.deny)}>
        {props.decision?.decision === 'deny' ? 'Denying…' : 'Deny'}
      </Button>
      <Show when={retryable() && props.decision}>
        {(decision) => <Button variant="primary" class="min-h-36! min-w-72 max-narrow:min-h-44!" disabled={props.readOnly || expirationBlocked()} onClick={() => !expirationBlocked() && props.onRetry?.(decision().commandId)}>Retry with original request</Button>}
      </Show>
    </div>
  </section>;
}
