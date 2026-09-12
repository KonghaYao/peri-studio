import { createEffect, createMemo, createSignal, createUniqueId, onCleanup, Show } from 'solid-js';
import { parsePermissionExpiration, type PendingPermission } from '@/entities/chat/control-view';
import type { PermissionDecisionState } from '@/features/message/permission-delivery';
import { Button } from '@peri/ui';
import { CircleAlert, Clock3, RefreshCw } from 'lucide-solid';
import { DecisionCard, type DecisionOption } from '@peri/ui';

function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return '';
  return id.length > length ? `${id.slice(0, length)}…` : id;
}

const OPTION_META: Record<'allowOnce' | 'allowSession' | 'deny', { label: string }> = {
  allowOnce: { label: 'Allow once' },
  allowSession: { label: 'Allow for this session' },
  deny: { label: 'Deny' },
};

function buildPermissionOptions(
  permission: PendingPermission,
  actionable: () => boolean,
  exactOptionRequired: () => boolean,
  locked: () => boolean,
  readOnly: boolean,
): DecisionOption[] {
  const keys = ['A', 'B', 'C', 'D', 'E'];
  let keyIndex = 0;
  const optionKeys = [...permission.options];
  if (!optionKeys.includes('deny')) optionKeys.push('deny');
  return optionKeys.map((option) => {
    const optionId = permission.optionIds?.[option];
    const unavailable = !actionable()
      || (exactOptionRequired() && option !== 'deny' && !optionId)
      || (exactOptionRequired() && option === 'deny' && permission.options.includes('deny') && !optionId);
    return {
      id: option,
      key: keys[keyIndex++] ?? String(keyIndex),
      label: OPTION_META[option].label,
      disabled: locked() || readOnly || unavailable,
    };
  });
}

export interface PermissionRequestCardProps {
  permission: PendingPermission;
  decision?: PermissionDecisionState;
  readOnly: boolean;
  onResolve: (decision: 'allow' | 'deny', optionId?: string) => void;
  onRetry?: (commandId: string) => void;
  currentIndex?: number;
  total?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  pagerPreviousLabel?: string;
  pagerNextLabel?: string;
}

/** A security decision surface. The server projection owns its lifetime; the
 * card only renders known facts and prevents a second, conflicting decision. */
export function PermissionRequestCard(props: PermissionRequestCardProps) {
  const domId = createUniqueId();
  const [now, setNow] = createSignal(Date.now());
  const [deadlineTick, setDeadlineTick] = createSignal(0);
  const [selectedId, setSelectedId] = createSignal<string>('');
  const expiresAt = () => parsePermissionExpiration(props.permission.expiresAt);
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
  const exactOptionRequired = () => props.permission.optionIds !== undefined;
  const locked = () => !!props.decision;
  const options = createMemo(() => buildPermissionOptions(props.permission, actionable, exactOptionRequired, locked, props.readOnly));
  createEffect(() => {
    const available = options().filter((option) => !option.disabled);
    const current = selectedId();
    if (current && available.some((option) => option.id === current)) return;
    setSelectedId(available[0]?.id ?? '');
  });
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
    if (options().some((option) => option.disabled && props.permission.options.includes(option.id as 'allowOnce' | 'allowSession' | 'deny'))) {
      return 'Some permission options unavailable';
    }
    return '';
  };
  const statusId = `permission-status-${domId}`;
  const titleId = `${statusId}-title`;
  const deadlineId = `permission-deadline-${domId}`;
  const describedBy = () => [deadlineLabel() ? deadlineId : '', status() ? statusId : ''].filter(Boolean).join(' ') || undefined;
  const detail = () => {
    const parts = [
      props.permission.description,
      props.permission.toolInputSummary,
      props.permission.toolCallId && !props.permission.toolInputSummary
        ? `tool ${shortId(props.permission.toolCallId)}`
        : null,
    ].filter(Boolean);
    return parts.join(' · ') || undefined;
  };
  const submit = () => {
    const selected = selectedId();
    if (!selected || props.readOnly || locked() || !actionable()) return;
    if (selected === 'deny') {
      props.onResolve('deny', props.permission.optionIds?.deny);
      return;
    }
    const optionId = selected === 'allowOnce'
      ? props.permission.optionIds?.allowOnce
      : props.permission.optionIds?.allowSession;
    if (exactOptionRequired() && !optionId) return;
    props.onResolve('allow', optionId);
  };
  const primaryDisabled = () => props.readOnly || locked() || !actionable() || !selectedId()
    || options().find((option) => option.id === selectedId())?.disabled;

  return (
    <DecisionCard
      data-testid="permission-request"
      class={`permission-request min-h-(--permission-card-min-height) ${uncertain() ? 'permission-request--uncertain' : ''}`}
      title="Permissions"
      prompt={props.permission.title || 'Permission request'}
      promptId={titleId}
      detail={detail()}
      options={options()}
      selectedId={selectedId()}
      onSelect={setSelectedId}
      currentIndex={props.currentIndex}
      total={props.total}
      onPrevious={props.onPrevious}
      onNext={props.onNext}
      pagerPreviousLabel={props.pagerPreviousLabel ?? 'Previous permission'}
      pagerNextLabel={props.pagerNextLabel ?? 'Next permission'}
      primaryDisabled={primaryDisabled()}
      primaryBusy={props.decision?.phase === 'pending'}
      onPrimary={submit}
      skipDisabled={props.readOnly || locked()}
      aria-describedby={describedBy()}
      aria-busy={locked() && !uncertain() ? 'true' : undefined}
      footer={retryable() && props.decision ? (
        <Button
          type="button"
          size="sm"
          variant="primary"
          class="rounded-full border-0 bg-accent-solid px-11 text-content-on-accent hover:bg-accent-hover active:bg-accent-active"
          disabled={props.readOnly || expirationBlocked()}
          onClick={() => !expirationBlocked() && props.onRetry?.(props.decision!.commandId)}
        >
          <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
          Retry with original request
        </Button>
      ) : undefined}
    >
      <Show when={deadlineLabel()}>
        <div id={deadlineId} class={`mt-7 flex items-center gap-5 text-10 leading-145 ${expirationBlocked() ? 'font-semibold text-warning' : 'text-text-muted'}`}>
          <Clock3 size={13} strokeWidth={1.8} aria-hidden="true" />
          <time dateTime={props.permission.expiresAt || undefined}>{deadlineLabel()}</time>
        </div>
      </Show>
      <Show when={status()}>
        <div
          id={statusId}
          title={status()}
          class={`permission-request__status mt-7 inline-flex size-22 items-center justify-center rounded-full border ${uncertain() ? 'border-warning-border text-warning' : 'border-border-subtle text-text-muted'}`}
          role={uncertain() ? 'alert' : 'status'}
          aria-live="polite"
        >
          <CircleAlert size={13} strokeWidth={1.8} aria-hidden="true" />
          <span class="sr-only">{status()}</span>
        </div>
      </Show>
      <Show when={props.permission.toolCallId && props.permission.toolInputSummary}>
        <code class="sr-only" title={props.permission.toolCallId || undefined}>tool {shortId(props.permission.toolCallId)}</code>
      </Show>
    </DecisionCard>
  );
}
