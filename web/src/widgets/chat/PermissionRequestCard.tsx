import { createEffect, createMemo, createSignal, createUniqueId, onCleanup, Show } from 'solid-js';
import { parsePermissionExpiration, type PendingPermission } from '@/entities/chat/control-view';
import type { PermissionDecisionState } from '@/features/message/permission-delivery';
import { read, type MaybeAccessor } from '@/shared/lib/maybe-accessor';
import { Button, QuestionnaireFrame, type QuestionnaireOption } from '@peri/ui';
import { CircleAlert, Clock3, RefreshCw } from 'lucide-solid';

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
): QuestionnaireOption[] {
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
  permission: MaybeAccessor<PendingPermission>;
  decision?: MaybeAccessor<PermissionDecisionState | undefined>;
  readOnly: MaybeAccessor<boolean>;
  onResolve: (decision: 'allow' | 'deny', optionId?: string) => void;
  onRetry?: (commandId: string) => void;
  currentIndex?: MaybeAccessor<number>;
  total?: MaybeAccessor<number>;
  onPrevious?: () => void;
  onNext?: () => void;
  pagerPreviousLabel?: string;
  pagerNextLabel?: string;
}

/** A security decision surface. The server projection owns its lifetime; the
 * card only renders known facts and prevents a second, conflicting decision. */
export function PermissionRequestCard(props: PermissionRequestCardProps) {
  const permission = () => read(props.permission);
  const decision = () => (props.decision === undefined ? undefined : read(props.decision));
  const currentIndex = () => (props.currentIndex === undefined ? undefined : read(props.currentIndex));
  const total = () => (props.total === undefined ? undefined : read(props.total));
  const readOnly = () => read(props.readOnly);
  const domId = createUniqueId();
  const [now, setNow] = createSignal(Date.now());
  const [deadlineTick, setDeadlineTick] = createSignal(0);
  const [selectedId, setSelectedId] = createSignal<string>('');
  const expiresAt = () => parsePermissionExpiration(permission().expiresAt);
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
  const actionable = () => !!permission().permissionId && !expirationBlocked();
  const exactOptionRequired = () => permission().optionIds !== undefined;
  const locked = () => !!decision();
  const options = createMemo(() => buildPermissionOptions(permission(), actionable, exactOptionRequired, locked, readOnly()));
  createEffect(() => {
    const available = options().filter((option) => !option.disabled);
    const current = selectedId();
    if (current && available.some((option) => option.id === current)) return;
    setSelectedId(available[0]?.id ?? '');
  });
  const uncertain = () => decision()?.phase === 'uncertain';
  const retryable = () => uncertain() && decision()?.retryable === true;
  const action = () => decision()?.decision === 'allow' ? 'Allow' : 'Deny';
  const status = () => {
    if (uncertain()) {
      if (expired()) return `${action()} not confirmed · Request expired`;
      if (invalidExpiration()) return `${action()} not confirmed · Expiration unavailable`;
      return retryable() ? `${action()} not confirmed · Retry available` : `${action()} not confirmed`;
    }
    if (locked()) return `${action()}ing…`;
    if (!actionable()) return 'Unavailable';
    if (readOnly()) return 'Read only';
    if (options().some((option) => option.disabled && permission().options.includes(option.id as 'allowOnce' | 'allowSession' | 'deny'))) {
      return 'Some permission options unavailable';
    }
    return '';
  };
  const statusId = `permission-status-${domId}`;
  const titleId = `${statusId}-title`;
  const deadlineId = `permission-deadline-${domId}`;
  const describedBy = () => [deadlineLabel() ? deadlineId : '', status() ? statusId : ''].filter(Boolean).join(' ') || undefined;
  const detail = () => {
    const current = permission();
    const parts = [
      current.description,
      current.toolInputSummary,
      current.toolCallId && !current.toolInputSummary
        ? `tool ${shortId(current.toolCallId)}`
        : null,
    ].filter(Boolean);
    return parts.join(' · ') || undefined;
  };
  const submit = () => {
    const selected = selectedId();
    if (!selected || readOnly() || locked() || !actionable()) return;
    const current = permission();
    if (selected === 'deny') {
      props.onResolve('deny', current.optionIds?.deny);
      return;
    }
    const optionId = selected === 'allowOnce'
      ? current.optionIds?.allowOnce
      : current.optionIds?.allowSession;
    if (exactOptionRequired() && !optionId) return;
    props.onResolve('allow', optionId);
  };
  const primaryDisabled = () => readOnly() || locked() || !actionable() || !selectedId()
    || options().find((option) => option.id === selectedId())?.disabled;

  return (
    <QuestionnaireFrame
      data-testid="permission-request"
      class="min-h-(--permission-card-min-height)"
      title="Permissions"
      prompt={permission().title || 'Permission request'}
      promptId={titleId}
      detail={detail()}
      options={options()}
      selectedId={selectedId()}
      onSelect={setSelectedId}
      currentIndex={currentIndex()}
      total={total()}
      onPrevious={props.onPrevious}
      onNext={props.onNext}
      pagerPreviousLabel={props.pagerPreviousLabel ?? 'Previous permission'}
      pagerNextLabel={props.pagerNextLabel ?? 'Next permission'}
      primaryDisabled={primaryDisabled()}
      primaryBusy={decision()?.phase === 'pending'}
      onPrimary={submit}
      skipDisabled={readOnly() || locked()}
      aria-describedby={describedBy()}
      aria-busy={locked() && !uncertain() ? 'true' : undefined}
      footer={retryable() && decision() ? (
        <Button
          type="button"
          size="sm"
          variant="primary"
          class="rounded-full border-0 bg-accent-solid px-11 text-content-on-accent hover:bg-accent-hover active:bg-accent-active"
          disabled={readOnly() || expirationBlocked()}
          onClick={() => !expirationBlocked() && props.onRetry?.(decision()!.commandId)}
        >
          <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
          Retry with original request
        </Button>
      ) : undefined}
    >
      <Show when={deadlineLabel()}>
        <div id={deadlineId} class={`mt-7 flex items-center gap-5 text-10 leading-145 ${expirationBlocked() ? 'font-semibold text-warning' : 'text-text-muted'}`}>
          <Clock3 size={13} strokeWidth={1.8} aria-hidden="true" />
          <time dateTime={permission().expiresAt || undefined}>{deadlineLabel()}</time>
        </div>
      </Show>
      <Show when={status()}>
        <div
          id={statusId}
          title={status()}
          class={`mt-7 inline-flex size-22 items-center justify-center rounded-full border ${uncertain() ? 'border-warning-border text-warning' : 'border-border-subtle text-text-muted'}`}
          role={uncertain() ? 'alert' : 'status'}
          aria-live="polite"
        >
          <CircleAlert size={13} strokeWidth={1.8} aria-hidden="true" />
          <span class="sr-only">{status()}</span>
        </div>
      </Show>
      <Show when={permission().toolCallId && permission().toolInputSummary}>
        <code class="sr-only" title={permission().toolCallId || undefined}>tool {shortId(permission().toolCallId)}</code>
      </Show>
    </QuestionnaireFrame>
  );
}
