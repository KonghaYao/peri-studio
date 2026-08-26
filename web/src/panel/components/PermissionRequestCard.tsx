import { createEffect, createSignal, createUniqueId, onCleanup, Show } from 'solid-js';
import { parsePermissionExpiration, type PendingPermission } from '../lib/control-view';
import type { PermissionDecisionState } from '../lib/permission-delivery';
import { CheckIcon, Icon, IconButton, RefreshIcon } from '../../components/ui';

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
  embedded?: boolean;
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
    class={`permission-request ${uncertain() ? 'permission-request--uncertain' : ''} grid grid-cols-permission gap-8 items-start m-0 bg-surface max-middle:grid-cols-[24px_minmax(0,1fr)] ${props.embedded ? 'rounded-0 border-0 p-12 shadow-none max-middle:p-10' : `rounded-(--decision-radius) border p-12 max-middle:p-10 ${uncertain() ? 'border-warning shadow-none' : 'border-border-subtle shadow-float'}`}`}
    aria-labelledby={`${statusId}-title`}
    aria-describedby={describedBy()}
    aria-busy={locked() && !uncertain() ? 'true' : undefined}
  >
    <div class="permission-request__mark grid size-24 place-items-center rounded-full border border-warning-border bg-surface text-warning" aria-hidden="true"><Icon class="size-14!"><path d="M10 3.5 16 6v4.5c0 3.5-2.4 5.6-6 6.8-3.6-1.2-6-3.3-6-6.8V6z" /><path d="M10 7.5v3M10 13h.01" /></Icon></div>
    <div class="permission-request__body min-w-0">
      <strong class="block text-text-primary text-12" id={`${statusId}-title`}>{props.permission.title || 'Permission request'}</strong>
      <Show when={props.permission.description}><p class="mt-3 text-text-secondary text-11 leading-15">{props.permission.description}</p></Show>
      <Show when={props.permission.toolInputSummary}>{(summary) => <div class="mt-8 rounded-8 border border-border-subtle bg-surface px-9 py-7 text-12 leading-145 text-text-secondary">
        <span class="sr-only">Requested input</span>
        <code class="block whitespace-pre-wrap break-words">{summary()}</code>
        <Show when={props.permission.toolCallId}><code class="mt-3 block text-11" title={props.permission.toolCallId || undefined}>tool {shortId(props.permission.toolCallId)}</code></Show>
      </div>}</Show>
      <Show when={!props.permission.toolInputSummary && props.permission.toolCallId}><code class="block mt-6 text-11 text-text-secondary" title={props.permission.toolCallId || undefined}>tool {shortId(props.permission.toolCallId)}</code></Show>
      <Show when={deadlineLabel()}><div id={deadlineId} class={`mt-7 flex items-center gap-5 text-11 leading-145 ${expirationBlocked() ? 'text-warning font-semibold' : 'text-text-muted'}`}>
        <Icon class="size-13!"><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5v4l2.5 1.5" /></Icon><time dateTime={props.permission.expiresAt || undefined}>{deadlineLabel()}</time>
      </div></Show>
      <Show when={status()}><div id={statusId} title={status()} class={`permission-request__status mt-7 inline-flex size-22 items-center justify-center rounded-full border ${uncertain() ? 'border-warning-border text-warning' : 'border-border-subtle text-text-muted'}`} role={uncertain() ? 'alert' : 'status'} aria-live="polite"><Icon class="size-13!"><circle cx="10" cy="10" r="6.5" /><path d="M10 7v3.5M10 13.5h.01" /></Icon><span class="sr-only">{status()}</span></div></Show>
    </div>
    <div class="permission-request__actions flex justify-end gap-5 self-center max-middle:col-span-full max-middle:w-full max-middle:pt-2">
      <Show when={allowLabel()}>{(label) => <IconButton tooltipPlacement="end" variant="primary" label={props.decision?.decision === 'allow' ? `${label()}…` : label()} class="size-32 min-h-32 rounded-full border-0 bg-success text-surface hover:bg-success max-narrow:size-44 max-narrow:min-h-44" disabled={props.readOnly || locked() || !allowActionable()} busy={props.decision?.phase === 'pending' && props.decision.decision === 'allow'} onClick={() => allowActionable() && props.onResolve('allow', allowOptionId())}>
        <CheckIcon />
      </IconButton>}</Show>
      <IconButton tooltipPlacement="end" variant="secondary" label={props.decision?.decision === 'deny' ? 'Denying…' : 'Deny'} class="size-32 min-h-32 rounded-full border-danger bg-danger text-surface hover:bg-danger max-narrow:size-44 max-narrow:min-h-44" disabled={props.readOnly || locked() || !denyActionable()} busy={props.decision?.phase === 'pending' && props.decision.decision === 'deny'} onClick={() => denyActionable() && props.onResolve('deny', props.permission.optionIds?.deny)}>
        <Icon><path d="m6 6 8 8M14 6l-8 8" /></Icon>
      </IconButton>
      <Show when={retryable() && props.decision}>
        {(decision) => <IconButton tooltipPlacement="end" variant="primary" label="Retry with original request" class="size-36 min-h-36 rounded-full border-0 bg-btn-primary text-surface max-narrow:size-44 max-narrow:min-h-44" disabled={props.readOnly || expirationBlocked()} onClick={() => !expirationBlocked() && props.onRetry?.(decision().commandId)}><RefreshIcon /></IconButton>}
      </Show>
    </div>
  </section>;
}
