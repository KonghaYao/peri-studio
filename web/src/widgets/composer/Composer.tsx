// 发送窗口（Composer）：输入区 + 底部工具行（ui.md §3.8 / §四.7）。
//
// 由 ChatView 拆出（右区三区之一）：悬浮大圆角卡片，textarea 自动增高
// （max 180px 后内部滚动），Enter 发送 / Shift+Enter 换行（含 IME
// 组合态防护）；底部工具行显示模型 / effort / 上下文占用（均来自 agent
// map，server 写入的真实配置）收进一个安静的模型标签，完整运行信息
// 通过 title 可发现；发送 / 停止主动作始终保留。
// 对话操作（新建/新会话/取消/关闭）已收敛到左侧对话列表区。
//
// P4：slash 菜单交互（caret/browseSkills/menuDismissed/activeCommandIndex
// 与键盘导航）在 lib/composer-slash；placeholder/disabled 决策在
// lib/composer-placeholder；inputPrediction 展示在 lib/composer-prediction。
// 本组件保留编排：信号装配、textarea 聚焦与草稿读写、提交/取消状态机。

import { createEffect, createSignal, createUniqueId, For, Show } from 'solid-js';
import { cancelTurn, chatHead, chatStatusSignal, openingSessionId, projectSessions, retryMessageSubmission, retryPersistentAction, runtimeDocsHydrated, selectedCid, selectedSessionId, sendMessage, turnActive } from '../../panel/store';
import { isTerminal } from '../../panel/lib/action-state';
import { promptDeliveryReady, promptMaxBytes } from '../../panel/lib/connection';
import { principalId, readOnly } from '../../panel/lib/auth-state';
import { composerDraft, hydrateComposerDraft, setComposerDraft, type ComposerDraftOwner } from '@/features/composer/composer-draft';
import { acknowledgeUnknownMessageDelivery, canAcknowledgeUnknownMessageDelivery, dismissFailedMessageDelivery, messageSubmission } from '../../panel/lib/message-delivery';
import { runtimeControlFor } from '../../panel/lib/runtime-control';
import { composerInputState } from '@/features/composer/composer-placeholder';
import { useComposerPrediction } from '@/features/composer/composer-prediction';
import { useComposerSlash } from '@/features/composer/composer-slash';
import { slashMenuOptionId } from '@/features/composer/slash-menu';
import { Button, IconButton, InlineNotice, Textarea } from '../../components/ui';
import { SlashMenu } from './SlashMenu';
import { SessionModelMenu } from '@/widgets/shell/SessionConfigDialog';
import { TokenUsageMeter, tokenUsageLabel } from '@/widgets/chat/TokenUsageMeter';
import { promptByteLength, promptFitsBudget } from '../../panel/lib/prompt-budget';
import { composerAssets, removeComposerAsset, type ComposerAssetKind } from '../../panel/lib/composer-assets';
import { composerQuoteRequest, consumeComposerQuoteRequest, formatComposerQuote } from '../../panel/lib/composer-quote';
import { Check, FileText, Image as ImageIcon, Link2, Mic, Plus, ScanLine, SendHorizontal, ShieldCheck, X } from 'lucide-solid';

/** tokens 数值 → "12k"/"200k" 缩写（>=1000 取 k；非法值 → null）。 */
function fmtTokens(n: number | null): string | null {
  if (n === null) return null;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function AttachmentIcon() {
  return <Plus size={18} strokeWidth={1.7} />;
}

function ApprovalIcon() {
  return <ShieldCheck size={18} strokeWidth={1.7} />;
}

function MicrophoneIcon() {
  return <Mic size={18} strokeWidth={1.7} />;
}

function AssetIcon(props: { kind: ComposerAssetKind }) {
  if (props.kind === 'image') return <ImageIcon size={21} strokeWidth={1.7} />;
  if (props.kind === 'reference') return <Link2 size={21} strokeWidth={1.7} />;
  return <FileText size={21} strokeWidth={1.7} />;
}

export function Composer() {
  let taRef: HTMLTextAreaElement | undefined;
  let modelTrigger: HTMLButtonElement | undefined;
  const slashMenuId = 'composer-slash-menu';
  const modelMenuId = 'composer-model-menu';
  const submissionStatusId = `composer-submission-${createUniqueId()}`;
  const promptBudgetStatusId = `composer-prompt-budget-${createUniqueId()}`;
  const [modelMenuOpen, setModelMenuOpen] = createSignal(false);
  let consumedQuoteId = 0;
  const draftOwner = (): ComposerDraftOwner | null => {
    const sessionId = selectedSessionId();
    const identity = principalId();
    const projectId = projectSessions().find((session) => session.id === sessionId)?.projectId;
    return identity && projectId && sessionId ? { principalId: identity, projectId, sessionId } : null;
  };
  createEffect(() => { void hydrateComposerDraft(draftOwner()); });
  const submissionForSession = () => messageSubmission(selectedSessionId());
  const submissionIsInFlight = () => ['sending', 'accepted', 'committed'].includes(submissionForSession()?.phase ?? '');
  const submissionNeedsAttention = () => ['uncertain', 'delivery_unknown', 'failed'].includes(submissionForSession()?.phase ?? '');
  const submissionTitle = () => {
    switch (submissionForSession()?.phase) {
      case 'uncertain': return 'Message result not confirmed';
      case 'delivery_unknown': return 'Message delivery result unknown';
      case 'failed': return 'Message was not sent';
      default: return '';
    }
  };
  const submissionDetail = () => {
    switch (submissionForSession()?.phase) {
      case 'uncertain': return 'Re-confirming uses the original request and does not create a second message.';
      case 'delivery_unknown': return canAcknowledgeUnknownMessageDelivery(submissionForSession()?.commandId ?? '')
        ? 'This message may already have executed. Resending and editing remain disabled to avoid duplicates.'
        : 'Twenty earlier deliveries are still unresolved. This message stays locked until an exact server projection clears one.';
      case 'failed': return 'Return to editing restores the text only to this project session draft.';
      default: return '';
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
      taRef?.focus();
      const cursor = taRef?.value.length ?? 0;
      taRef?.setSelectionRange(cursor, cursor);
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

  // 可用性与 placeholder（lib/composer-placeholder，纯函数）。
  const inputState = () => composerInputState({
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
  const inputPlaceholder = () => inputState().placeholder;
  const inputDescribedBy = () => [
    prediction.activePrediction() ? 'composer-prediction-description' : null,
    submissionNeedsAttention() ? submissionStatusId : null,
    promptOverBudget() ? promptBudgetStatusId : null,
  ].filter(Boolean).join(' ') || undefined;
  const draftBytes = () => promptByteLength(composerDraft(draftOwner()));
  const promptOverBudget = () => !!composerDraft(draftOwner())
    && !promptFitsBudget(composerDraft(draftOwner()), promptMaxBytes());

  // 信息行三个真实值（agent map，server 写入；缺失 → —）。
  const model = () => chatHead()?.agent?.model || '—';
  const effort = () => chatHead()?.agent?.effort || '—';

  // 上下文占用（tokens）：12k/200k；任一缺失显示 —。
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
  const preciseUsage = () => latestUsage() ? tokenUsageLabel(latestUsage()!) : null;
  const commandCatalog = () => chatHead()?.agent?.commandCatalog ?? [];
  const skillCount = () => commandCatalog().filter((command) => command.kind !== 'command').length;
  const canBrowseSkills = () => !!chatHead()?.agent?.extensions.includes('peri.skillNames')
    && skillCount() > 0;
  const runtimeSummary = () => {
    const parts = [`Model ${model()}`];
    if (effort() !== '—') parts.push(`Reasoning effort ${effort()}`);
    if (ctxText() !== '—') parts.push(`Context ${ctxText()}`);
    if (preciseUsage()) parts.push(`Last request ${preciseUsage()}`);
    return parts.join(' · ');
  };

  // 草稿写入 + caret 聚焦的公共路径（slash 插入 / prediction 接受共用）。
  const focusAt = (cursor: number) => {
    queueMicrotask(() => {
      taRef?.focus();
      taRef?.setSelectionRange(cursor, cursor);
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

  // slash 菜单交互（lib/composer-slash）。
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

  // inputPrediction 展示（lib/composer-prediction）。
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

  function submit() {
    const text = composerDraft(draftOwner()).trim();
    if (!text || !promptFitsBudget(text, promptMaxBytes())) return;
    if (!sendMessage(text)) return;
    if (taRef) {
      // 先同步清空 DOM 值再测量：value 绑定是延迟 effect，若在
      // setMsg('') 后立即测 scrollHeight 会测到旧多行文本的高度，
      // 发送后 Composer 保持展开高度不收回（min-h 52px 兜底）
      taRef.value = '';
      taRef.style.height = 'auto';
      taRef.style.height = `${taRef.scrollHeight}px`;
    }
  }

  return (
    <div class="composer-wrap composer-wrap--overlay relative box-border w-full max-w-(--container-chat) mx-auto px-20 pb-[calc(var(--space-20)+env(safe-area-inset-bottom))] desk:max-wide:max-w-(--container-chat-narrow) desk:max-wide:px-18 wide:max-w-(--container-chat) wide:px-20 max-desk:max-w-(--container-chat-narrow) max-narrow:px-10">
      <Show when={slash.slashMenuOpen()}>
        <SlashMenu
          id={slashMenuId}
          items={slash.slashItems()}
          activeIndex={slash.boundedActiveIndex()}
          onActiveIndex={slash.onMenuActiveIndex}
          onSelect={(item) => slash.selectCommand(item.name)}
          onKeyDown={(event) => { slash.handleKeyDown(event); }}
        />
      </Show>
      <section
        aria-busy={submissionIsInFlight() || undefined}
        aria-disabled={inputDisabled()}
        class="composer-surface overflow-hidden border border-composer-border rounded-(--composer-radius) bg-surface-overlay p-2.5 shadow-float max-narrow:rounded-16"
      >
        <Show when={composerAssets().length > 0}>
          <div class="composer-assets ui-scrollbar flex gap-7 overflow-x-auto pb-7" aria-label="Staged assets">
            <For each={composerAssets()}>{(asset) => <article class="group relative grid shrink-0 grid-rows-[1fr_auto] overflow-hidden rounded-md border border-border-subtle bg-surface-canvas p-1.5" style={{ width: 'var(--asset-tile-size)', height: 'var(--asset-tile-size)' }} title={asset.detail || asset.name}>
              <Show when={asset.kind === 'image' && asset.previewUrl} fallback={<span class="grid place-items-center text-content-muted"><AssetIcon kind={asset.kind} /></span>}>
                    <img src={asset.previewUrl} alt="" class="h-full w-full rounded-sm object-cover" />
                  </Show>
                  <IconButton label={`Remove ${asset.name}`} title={`Remove ${asset.name}`} size="sm" class="absolute top-0.5 right-0.5 size-5 bg-surface-overlay/90 p-0" onClick={() => removeComposerAsset(asset.id)}><X size={11} strokeWidth={2} /></IconButton>
              <strong class="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-9 font-medium text-content-secondary">{asset.name}</strong>
            </article>}</For>
          </div>
        </Show>
        <div class="composer-editor relative">
          <Show when={prediction.activePrediction()}>{(prediction) => <>
            <span class="composer-prediction absolute z-0 top-10 right-8 left-8 overflow-hidden text-text-faint text-12 leading-18 pointer-events-none text-ellipsis whitespace-nowrap" aria-hidden="true">{prediction().text}</span>
            <span id="composer-prediction-description" class="sr-only">
              Peri suggests: {prediction().text}. Press Tab to use it, or Escape to ignore.
            </span>
          </>}</Show>
          <Textarea
          ref={taRef}
          autoResize
          maxHeight={180}
          value={composerDraft(draftOwner())}
          onInput={(e) => {
            // 中文 IME 组合期间 DOM value 只是候选中间态。若此时写回受控
            // state，浏览器会重置输入法维护的组合范围，最终提交可能再次追加
            // 同一段文本。只在组合完成后提交一次最终值。
            if (e.isComposing) return;
            commitInputValue(e.currentTarget);
          }}
          onCompositionEnd={(e) => commitInputValue(e.currentTarget)}
          onSelect={(e) => slash.onCaret(e.currentTarget)}
          onBlur={slash.onBlur}
          onKeyDown={(e) => {
            if (e.isComposing || e.keyCode === 229) return; // IME 组合确认回车不误发
            if (slash.handleKeyDown(e)) return;
            if (prediction.activePrediction() && e.key === 'Tab') {
              e.preventDefault();
              prediction.accept();
              return;
            }
            if (prediction.activePrediction() && e.key === 'Escape') {
              e.preventDefault();
              prediction.dismiss();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={prediction.activePrediction() ? '' : inputPlaceholder()}
          disabled={inputDisabled()}
          aria-label="Message the agent"
          aria-autocomplete="list"
          aria-expanded={slash.slashMenuOpen()}
          aria-controls={slash.slashMenuOpen() ? slashMenuId : undefined}
          aria-activedescendant={slash.slashMenuOpen()
            ? (() => {
              const active = slash.slashItems()[slash.boundedActiveIndex()];
              return active ? slashMenuOptionId(slashMenuId, active.name) : undefined;
            })()
            : undefined}
          aria-describedby={inputDescribedBy()}
          spellcheck={false}
          class="composer-input ui-scrollbar relative z-1 block min-h-9 max-h-180 w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-2 text-13 leading-normal text-content-primary outline-0 placeholder:text-content-muted disabled:bg-transparent disabled:text-content-secondary focus-visible:outline-0"
          />
        </div>
        <Show when={promptOverBudget()}>
          <InlineNotice id={promptBudgetStatusId} class="mb-8" tone="danger" role="alert" title="Message is too large">
            <span>{draftBytes()} / {promptMaxBytes()} bytes. Shorten the message before sending.</span>
          </InlineNotice>
        </Show>
        <Show when={submissionNeedsAttention() ? submissionForSession() : null}>{(submission) =>
          <InlineNotice
            id={submissionStatusId}
            class={`composer-submission composer-submission--${submission().phase} mt-2 mb-8 border-dashed`}
            title={submissionTitle()}
            tone={submissionTone()}
            role="note"
          >
            <p>{submissionDetail()}</p>
            <div class="composer-submission__actions flex flex-wrap gap-6 mt-8">
              <Show when={submission().phase === 'uncertain' && submission().retryable}>
                <Button size="compact" variant="secondary" class="pointer-coarse:min-h-44" onClick={retryMessageSubmission}>Confirm with the same request</Button>
              </Show>
              <Show when={submission().phase === 'failed'}>
                <Button size="compact" class="pointer-coarse:min-h-44" onClick={restoreFailedDraft}>Back to edit</Button>
              </Show>
              <Show when={submission().phase === 'delivery_unknown'}>
                <Button size="compact" variant="secondary" class="pointer-coarse:min-h-44" disabled={!canAcknowledgeUnknownMessageDelivery(submission().commandId)} onClick={() => {
                  if (!acknowledgeUnknownMessageDelivery(submission().commandId)) return;
                  queueMicrotask(() => taRef?.focus());
                }}>Acknowledge and continue</Button>
              </Show>
            </div>
          </InlineNotice>
        }</Show>
        <div class="composer-toolbar flex min-h-36 items-center gap-1">
          <IconButton label="Add attachment" title="Attachments are not connected yet" disabled class="composer-attachment shrink-0 border-0 bg-transparent text-content-primary disabled:opacity-55">
            <AttachmentIcon />
          </IconButton>
          <IconButton label="Approval mode" title="Approval mode is not connected yet" disabled class="composer-approval shrink-0 border-0 bg-transparent text-content-muted disabled:opacity-55">
            <ApprovalIcon />
          </IconButton>
          <Show when={prediction.activePrediction()}>
            <Button size="compact" variant="secondary" class="composer-prediction-action inline-flex min-h-30 items-center justify-center px-9 border-border-subtle bg-surface-muted text-text-secondary text-11 pointer-coarse:min-h-44 max-narrow:min-h-44" onClick={prediction.accept} aria-label="Use suggestion" title="Use suggestion (Tab)">
              <Check size={16} strokeWidth={1.7} /><kbd class="ml-3 px-4 py-2 border border-border-subtle rounded-4 bg-surface text-9 max-narrow:hidden">Tab</kbd>
            </Button>
          </Show>
          <Show when={canBrowseSkills()}>
            <Button
              size="compact"
              class="composer-skills relative inline-flex w-34 min-h-30 items-center justify-center gap-0 rounded-7 border-0 bg-transparent p-0 text-text-primary text-11 font-normal pointer-coarse:w-48 pointer-coarse:min-h-44 max-tight:before:content-['/'] max-tight:before:font-mono max-tight:before:text-15 max-tight:before:leading-none max-tight:before:font-bold"
              aria-expanded={slash.browseSkills() && slash.slashMenuOpen()}
              aria-controls={slashMenuId}
              aria-label={`Browse skills (${skillCount()})`}
              title={`Browse skills (${skillCount()})`}
              onClick={() => {
                slash.toggleBrowse(taRef);
                queueMicrotask(() => taRef?.focus());
              }}
              disabled={inputDisabled()}
            ><ScanLine size={17} strokeWidth={1.7} class="max-tight:hidden" aria-hidden="true" /><span class="composer-skills__count sr-only">{skillCount()}</span></Button>
          </Show>
          <span class="composer-shortcut sr-only" aria-hidden="true">Enter to send · Shift + Enter for newline</span>
          <div class="composer-toolbar__right ml-auto flex min-w-0 items-center gap-1">
          <Show when={latestUsage()}>{(usage) =>
            <TokenUsageMeter usage={usage()} contextWindow={chatHead()?.agent?.contextWindow ?? null} />
          }</Show>
          <SessionModelMenu open={modelMenuOpen()} id={modelMenuId} onOpenChange={setModelMenuOpen} trigger={
            <Button
              size="compact"
              class="composer-runtime min-h-7 max-w-(--model-badge-max) shrink-0 gap-1 overflow-hidden border-0 bg-sidebar-selected px-2 text-10 text-success-solid hover:bg-sidebar-selected"
              ref={modelTrigger}
              title={runtimeSummary()}
              aria-label="Choose model"
              disabled={!selectedCid() || !runtimeDocsHydrated()}
            ><span class="overflow-hidden text-ellipsis whitespace-nowrap">{model()}</span></Button>
          } />
          <span class="composer-voice-slot flex w-34 min-h-30 shrink-0 items-center justify-center">
            <IconButton label="Voice input" title="Voice input is not connected yet" disabled class="composer-voice shrink-0 border-0 bg-transparent text-text-primary disabled:opacity-55">
              <MicrophoneIcon />
            </IconButton>
          </span>
          <Show when={turnActive()} fallback={
            <span class="shrink-0"><IconButton tooltipPlacement="end" variant="primary" type="button" onClick={submit} disabled={inputDisabled() || !composerDraft(draftOwner()).trim() || promptOverBudget()} label="Send" class="composer-action flex w-36 min-h-32 shrink-0 items-center justify-center rounded-8 border-0 bg-btn-primary text-surface cursor-pointer hover:bg-btn-primary-hover disabled:cursor-not-allowed disabled:bg-border-subtle disabled:text-text-faint max-narrow:w-48 max-narrow:min-h-44">
              <SendHorizontal size={18} strokeWidth={1.7} />
            </IconButton></span>
          }>
            <span class="shrink-0"><IconButton tooltipPlacement="end" variant="primary" type="button" onClick={requestCancel} disabled={cancelLocked() || readOnly()} busy={cancelControl()?.phase === 'sending' || cancelControl()?.phase === 'accepted'} label={cancelLabel()} class={`composer-action composer-action--stop flex w-36 min-h-32 shrink-0 items-center justify-center rounded-8 border-0 bg-btn-primary text-surface cursor-pointer hover:bg-btn-primary-hover disabled:cursor-not-allowed disabled:bg-border-subtle disabled:text-text-faint max-narrow:w-48 max-narrow:min-h-44 ${cancelControl()?.phase === 'uncertain' ? 'bg-warning hover:bg-warning-strong' : ''}`}>
              <Show when={!cancelControl() || cancelControl()?.phase === 'uncertain' || cancelControl()?.phase === 'confirmed'}><span aria-hidden="true" class="size-10 rounded-2 bg-current" /></Show>
            </IconButton></span>
          </Show>
          </div>
        </div>
      </section>
    </div>
  );
}
