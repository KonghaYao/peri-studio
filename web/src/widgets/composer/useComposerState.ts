import { createEffect, createUniqueId } from 'solid-js';
import {
  cancelTurn,
  chatHead,
  chatStatusSignal,
  openingSessionId,
  projectSessions,
  retryMessageSubmission,
  retryPersistentAction,
  runtimeDocsHydrated,
  selectedCid,
  selectedSessionId,
  sendMessage,
  sessionConfigMutation,
  turnActive,
} from '@/store';
import { isTerminal } from '@/features/runtime/action-state';
import { promptDeliveryReady, promptMaxBytes } from '@/features/connection/connection';
import { principalId, readOnly } from '@/features/auth/auth-state';
import {
  composerDraft,
  hydrateComposerDraft,
  setComposerDraft,
  type ComposerDraftOwner,
} from '@/features/composer/composer-draft';
import { composerModelLabel } from '@/features/composer/composer-model-label';
import {
  acknowledgeUnknownMessageDelivery,
  canAcknowledgeUnknownMessageDelivery,
  dismissFailedMessageDelivery,
  messageSubmission,
} from '@/features/message/message-delivery';
import { runtimeControlFor } from '@/features/runtime/runtime-control';
import { composerInputState } from '@/features/composer/composer-placeholder';
import { useComposerPrediction } from '@/features/composer/composer-prediction';
import { useComposerSlash } from '@/features/composer/composer-slash';
import { clearSubmittedWorkspaceUploads } from '@/store';
import { tokenUsageLabel } from '@/widgets/chat/TokenUsageMeter';
import { promptByteLength, promptFitsBudget } from '@/shared/lib/prompt-budget';
import {
  composerQuoteRequest,
  consumeComposerQuoteRequest,
  formatComposerQuote,
} from '@/features/composer/composer-quote';

/** tokens 数值 → "12k"/"200k" 缩写（>=1000 取 k；非法值 → null）。 */
function fmtTokens(n: number | null): string | null {
  if (n === null) return null;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function useComposerState(taRef: () => HTMLTextAreaElement | undefined) {
  const slashMenuId = 'composer-slash-menu';
  const modelMenuId = 'composer-model-menu';
  const uploadDropDescId = `composer-upload-drop-${createUniqueId()}`;
  const submissionStatusId = `composer-submission-${createUniqueId()}`;
  const promptBudgetStatusId = `composer-prompt-budget-${createUniqueId()}`;
  let uploadFileInputRef: HTMLInputElement | undefined;
  let consumedQuoteId = 0;

  const draftOwner = (): ComposerDraftOwner | null => {
    const sessionId = selectedSessionId();
    const identity = principalId();
    const projectId = projectSessions().find((session) => session.id === sessionId)?.projectId;
    return identity && projectId && sessionId ? { principalId: identity, projectId, sessionId } : null;
  };

  createEffect(() => {
    void hydrateComposerDraft(draftOwner());
  });

  const submissionForSession = () => messageSubmission(selectedSessionId());
  const submissionIsInFlight = () => ['sending', 'accepted', 'committed'].includes(submissionForSession()?.phase ?? '');
  const submissionNeedsAttention = () => ['uncertain', 'delivery_unknown', 'failed'].includes(submissionForSession()?.phase ?? '');
  const submissionTitle = () => {
    switch (submissionForSession()?.phase) {
      case 'uncertain':
        return 'Message result not confirmed';
      case 'delivery_unknown':
        return 'Message delivery result unknown';
      case 'failed':
        return 'Message was not sent';
      default:
        return '';
    }
  };
  const submissionDetail = () => {
    switch (submissionForSession()?.phase) {
      case 'uncertain':
        return 'Re-confirming uses the original request and does not create a second message.';
      case 'delivery_unknown':
        return canAcknowledgeUnknownMessageDelivery(submissionForSession()?.commandId ?? '')
          ? 'This message may already have executed. Resending and editing remain disabled to avoid duplicates.'
          : 'Twenty earlier deliveries are still unresolved. This message stays locked until an exact server projection clears one.';
      case 'failed':
        return 'Return to editing restores the text only to this project session draft.';
      default:
        return '';
    }
  };
  const submissionTone = () => {
    const phase = submissionForSession()?.phase;
    return phase === 'failed' ? 'danger' : phase === 'uncertain' || phase === 'delivery_unknown' ? 'warning' : 'info';
  };
  const restoreFailedDraft = () => {
    const commandId = submissionForSession()?.commandId;
    if (!commandId) return;
    dismissFailedMessageDelivery(commandId);
    queueMicrotask(() => {
      const ta = taRef();
      ta?.focus();
      const cursor = ta?.value.length ?? 0;
      ta?.setSelectionRange(cursor, cursor);
    });
  };
  const terminal = () => isTerminal(chatStatusSignal()[selectedCid() ?? '']);
  const cancelControl = () => {
    const control = runtimeControlFor(selectedCid());
    return control?.kind === 'cancel' ? control : null;
  };
  const cancelLocked = () => {
    const phase = cancelControl()?.phase;
    return phase === 'sending' || phase === 'accepted' || phase === 'confirmed';
  };
  const cancelLabel = () => {
    const phase = cancelControl()?.phase;
    if (phase === 'sending' || phase === 'accepted') return 'Stopping generation';
    if (phase === 'uncertain') return 'Confirm stop with original request';
    if (phase === 'confirmed') return 'Waiting for Agent to stop';
    return 'Stop generation';
  };
  const requestCancel = () => {
    const control = cancelControl();
    if (control?.phase === 'uncertain') {
      retryPersistentAction(control.commandId);
      return;
    }
    cancelTurn();
  };

  const inputState = () =>
    composerInputState({
      readOnly: readOnly(),
      openingSessionId: openingSessionId(),
      selectedCid: selectedCid(),
      runtimeDocsHydrated: runtimeDocsHydrated(),
      promptDeliveryReady: promptDeliveryReady(),
      terminal: terminal(),
      turnActive: turnActive(),
      submissionForSession: !!submissionForSession(),
    });
  const inputDisabled = () => inputState().disabled;
  const sendLocked = () => inputState().sendLocked;
  const inputPlaceholder = () => inputState().placeholder;

  const draftBytes = () => promptByteLength(composerDraft(draftOwner()));
  const promptOverBudget = () =>
    !!composerDraft(draftOwner()) && !promptFitsBudget(composerDraft(draftOwner()), promptMaxBytes());

  const model = () => composerModelLabel(chatHead()?.agent ?? null, sessionConfigMutation());
  const effort = () => chatHead()?.agent?.effort || '—';
  const ctxText = () => {
    const used = fmtTokens(chatHead()?.agent?.contextUsed ?? null);
    const cap = fmtTokens(chatHead()?.agent?.contextWindow ?? null);
    if (used === null || cap === null) return '—';
    return `${used}/${cap}`;
  };
  const latestUsage = () => {
    const agent = chatHead()?.agent;
    if (!agent?.extensions.includes('peri.tokenStats')) return null;
    const usage = agent.latestUsage;
    if (!usage || usage.inputTokens === null || usage.outputTokens === null) return null;
    return usage;
  };
  const preciseUsage = () => (latestUsage() ? tokenUsageLabel(latestUsage()!) : null);
  const commandCatalog = () => chatHead()?.agent?.commandCatalog ?? [];
  const skillCount = () => commandCatalog().filter((command) => command.kind !== 'command').length;
  const canBrowseSkills = () =>
    !!chatHead()?.agent?.extensions.includes('peri.skillNames') && skillCount() > 0;
  const runtimeSummary = () => {
    const parts = [`Model ${model()}`];
    if (effort() !== '—') parts.push(`Reasoning effort ${effort()}`);
    if (ctxText() !== '—') parts.push(`Context ${ctxText()}`);
    if (preciseUsage()) parts.push(`Last request ${preciseUsage()}`);
    return parts.join(' · ');
  };

  const focusAt = (cursor: number) => {
    queueMicrotask(() => {
      const ta = taRef();
      ta?.focus();
      ta?.setSelectionRange(cursor, cursor);
    });
  };

  createEffect(() => {
    const request = composerQuoteRequest();
    const owner = draftOwner();
    if (!request || !owner || request.id === consumedQuoteId) return;
    const current = composerDraft(owner).trimEnd();
    const quote = formatComposerQuote(request);
    setComposerDraft(owner, current ? `${current}\n\n${quote}\n\n` : `${quote}\n\n`);
    consumedQuoteId = request.id;
    consumeComposerQuoteRequest(request.id);
    focusAt(composerDraft(owner).length);
  });

  const slash = useComposerSlash({
    draft: () => composerDraft(draftOwner()),
    catalog: commandCatalog,
    enabled: () => !inputDisabled(),
    canBrowseSkills,
    onInsert: (text, caret) => {
      setComposerDraft(draftOwner(), text);
      slash.setCaret(caret);
      focusAt(caret);
    },
  });

  const commitInputValue = (el: HTMLTextAreaElement) => {
    setComposerDraft(draftOwner(), el.value);
    slash.onInputValue(el);
  };

  const prediction = useComposerPrediction({
    agent: () => chatHead()?.agent ?? null,
    draft: () => composerDraft(draftOwner()),
    sessionId: selectedSessionId,
    inputDisabled,
    onAccept: (text) => {
      setComposerDraft(draftOwner(), text);
      slash.setCaret(text.length);
      focusAt(text.length);
    },
  });

  const inputDescribedBy = () =>
    [
      prediction.activePrediction() ? 'composer-prediction-description' : null,
      submissionNeedsAttention() ? submissionStatusId : null,
      promptOverBudget() ? promptBudgetStatusId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  function submit() {
    if (inputDisabled() || sendLocked()) return;
    const owner = draftOwner();
    const text = composerDraft(owner).trim();
    if (!text || !promptFitsBudget(text, promptMaxBytes())) return;
    if (!sendMessage(text)) return;
    if (owner) clearSubmittedWorkspaceUploads(owner.projectId, 'composer');
    const ta = taRef();
    if (ta) {
      ta.value = '';
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }

  const runtimeMenuDisabled = () => !selectedCid() || !runtimeDocsHydrated();

  return {
    slashMenuId,
    modelMenuId,
    uploadDropDescId,
    submissionStatusId,
    promptBudgetStatusId,
    get uploadFileInputRef() {
      return uploadFileInputRef;
    },
    setUploadFileInputRef(el: HTMLInputElement | undefined) {
      uploadFileInputRef = el;
    },
    draftOwner,
    submissionForSession,
    submissionIsInFlight,
    submissionNeedsAttention,
    submissionTitle,
    submissionDetail,
    submissionTone,
    restoreFailedDraft,
    retryMessageSubmission,
    acknowledgeUnknownMessageDelivery,
    canAcknowledgeUnknownMessageDelivery,
    inputDisabled,
    sendLocked,
    inputPlaceholder,
    draftBytes,
    promptOverBudget,
    promptMaxBytes,
    runtimeSummary,
    latestUsage,
    chatHead,
    slash,
    prediction,
    commitInputValue,
    focusAt,
    submit,
    turnActive,
    readOnly,
    cancelControl,
    cancelLocked,
    cancelLabel,
    requestCancel,
    canBrowseSkills,
    skillCount,
    inputDescribedBy,
    composerDraft,
    setComposerDraft,
    runtimeMenuDisabled,
  };
}

export type ComposerState = ReturnType<typeof useComposerState>;
