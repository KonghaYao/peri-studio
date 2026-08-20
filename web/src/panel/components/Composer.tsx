// 发送窗口（Composer）：输入区 + 底部工具行（ui.md §3.8 / §四.7）。
//
// 由 ChatView 拆出（右区三区之一）：悬浮大圆角卡片，textarea 自动增高
// （max 180px 后内部滚动），Enter 发送 / Shift+Enter 换行（含 IME
// 组合态防护）；底部工具行显示模型 / effort / 上下文占用（均来自 agent
// map，server 写入的真实配置）收进一个安静的运行标识，完整值
// 通过 title 可发现；发送 / 停止主动作始终保留。
// 对话操作（新建/新会话/取消/关闭）已收敛到左侧对话列表区。
//
// P4：slash 菜单交互（caret/browseSkills/menuDismissed/activeCommandIndex
// 与键盘导航）在 lib/composer-slash；placeholder/disabled 决策在
// lib/composer-placeholder；inputPrediction 展示在 lib/composer-prediction。
// 本组件保留编排：信号装配、textarea 聚焦与草稿读写、提交/取消状态机。

import { createSignal, createUniqueId, Show } from 'solid-js';
import { cancelTurn, chatHead, chatStatusSignal, navigateProjectSession, openingSessionId, projectSessions, retryMessageSubmission, retryPersistentAction, runtimeDocsHydrated, selectedCid, selectedSessionId, sendMessage, turnActive } from '../store';
import { isTerminal } from '../lib/action-state';
import { promptDeliveryReady } from '../lib/connection';
import { readOnly } from '../lib/auth-state';
import { composerDraft, setComposerDraft } from '../lib/composer-draft';
import { dismissFailedMessageDelivery, messageSubmission } from '../lib/message-delivery';
import { runtimeControlFor } from '../lib/runtime-control';
import { composerInputState } from '../lib/composer-placeholder';
import { useComposerPrediction } from '../lib/composer-prediction';
import { useComposerSlash } from '../lib/composer-slash';
import { Button, Icon, IconButton, InlineNotice, Textarea } from '../../components/ui';
import { SlashMenu } from './SlashMenu';
import { SessionModelMenu } from './SessionConfigDialog';
import { TokenUsageMeter, tokenUsageLabel } from './TokenUsageMeter';

/** tokens 数值 → "12k"/"200k" 缩写（>=1000 取 k；非法值 → null）。 */
function fmtTokens(n: number | null): string | null {
  if (n === null) return null;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function AttachmentIcon() {
  return <Icon class="size-18!"><path d="M10 4v12M4 10h12" /></Icon>;
}

function ApprovalIcon() {
  return <Icon class="size-18!"><path d="M10 3.5 16 6v4.5c0 3.5-2.4 5.6-6 6.8-3.6-1.2-6-3.3-6-6.8V6z" /><path d="m7.5 10.5 1.7 1.7 3.5-4" /></Icon>;
}

function MicrophoneIcon() {
  return <Icon><rect x="7" y="3" width="6" height="10" rx="3" /><path d="M4.5 10.5a5.5 5.5 0 0 0 11 0M10 16v2M7.5 18h5" /></Icon>;
}

export function Composer() {
  let taRef: HTMLTextAreaElement | undefined;
  let modelTrigger: HTMLButtonElement | undefined;
  const slashMenuId = 'composer-slash-menu';
  const modelMenuId = 'composer-model-menu';
  const submissionStatusId = `composer-submission-${createUniqueId()}`;
  const [modelMenuOpen, setModelMenuOpen] = createSignal(false);
  const submissionForSession = () => messageSubmission()?.sessionId === selectedSessionId() ? messageSubmission() : null;
  const submissionInAnotherSession = () => messageSubmission() && !submissionForSession() ? messageSubmission() : null;
  const submissionIsInFlight = () => ['sending', 'accepted', 'committed'].includes(submissionForSession()?.phase ?? '');
  const submissionTitle = () => {
    switch (submissionForSession()?.phase) {
      case 'accepted': return 'Message received by the server';
      case 'committed': return 'Message confirmed by the server';
      case 'uncertain': return 'Message result not confirmed';
      case 'delivery_unknown': return 'Message delivery result unknown';
      case 'failed': return 'Message was not sent';
      default: return 'Sending message';
    }
  };
  const submissionDetail = () => {
    switch (submissionForSession()?.phase) {
      case 'accepted': return 'Waiting for final confirmation before the conversation updates.';
      case 'committed': return 'Waiting for the server-authoritative conversation projection.';
      case 'uncertain': return 'Re-confirming uses the original request and does not create a second message.';
      case 'delivery_unknown': return 'This message may already have executed. Resending and editing remain disabled to avoid duplicates.';
      case 'failed': return 'Return to editing restores the text only to this project session draft.';
      default: return 'The message is not part of the conversation until the server projects it.';
    }
  };
  const submissionTone = () => {
    const phase = submissionForSession()?.phase;
    return phase === 'failed' ? 'danger' : phase === 'uncertain' || phase === 'delivery_unknown' ? 'warning' : 'info';
  };
  const restoreFailedDraft = () => {
    dismissFailedMessageDelivery();
    queueMicrotask(() => {
      taRef?.focus();
      const cursor = taRef?.value.length ?? 0;
      taRef?.setSelectionRange(cursor, cursor);
    });
  };
  const pendingSessionTitle = () => {
    const submission = submissionInAnotherSession();
    return projectSessions().find((session) => session.id === submission?.sessionId)?.title || 'another session';
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
    hasSubmission: !!messageSubmission(),
    submissionForSession: !!submissionForSession(),
    submissionInAnotherSession: !!submissionInAnotherSession(),
  });
  const inputDisabled = () => inputState().disabled;
  const inputPlaceholder = () => inputState().placeholder;
  const inputDescribedBy = () => [
    prediction.activePrediction() ? 'composer-prediction-description' : null,
    submissionForSession() ? submissionStatusId : null,
  ].filter(Boolean).join(' ') || undefined;

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

  // slash 菜单交互（lib/composer-slash）。
  const slash = useComposerSlash({
    draft: () => composerDraft(selectedSessionId()),
    catalog: commandCatalog,
    enabled: () => !inputDisabled(),
    canBrowseSkills,
    onInsert: (text, caret) => {
      setComposerDraft(selectedSessionId(), text);
      slash.setCaret(caret);
      focusAt(caret);
    },
  });

  // inputPrediction 展示（lib/composer-prediction）。
  const prediction = useComposerPrediction({
    agent: () => chatHead()?.agent ?? null,
    draft: () => composerDraft(selectedSessionId()),
    sessionId: selectedSessionId,
    inputDisabled,
    onAccept: (text) => {
      setComposerDraft(selectedSessionId(), text);
      slash.setCaret(text.length);
      focusAt(text.length);
    },
  });

  function submit() {
    const text = composerDraft(selectedSessionId()).trim();
    if (!text) return;
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
        />
      </Show>
      <section
        aria-busy={submissionIsInFlight() || undefined}
        aria-disabled={inputDisabled()}
        class="composer-surface overflow-hidden border border-composer-border rounded-[20px] bg-surface shadow-float transition-[box-shadow,border-color] duration-[140ms] ease-[ease] focus-within:border-focus-ring focus-within:shadow-float has-[.composer-input:focus-visible]:shadow-[var(--shadow-float),0_0_0_1px_var(--surface),0_0_0_3px_var(--focus-ring)] max-narrow:rounded-16"
      >
        <div class="composer-editor relative">
          <Show when={prediction.activePrediction()}>{(prediction) => <>
            <span class="composer-prediction absolute z-0 top-14 right-16 left-16 overflow-hidden text-text-faint text-15 leading-22 pointer-events-none text-ellipsis whitespace-nowrap max-narrow:right-15 max-narrow:left-15" aria-hidden="true">{prediction().text}</span>
            <span id="composer-prediction-description" class="sr-only">
              Peri suggests: {prediction().text}. Press Tab to use it, or Escape to ignore.
            </span>
          </>}</Show>
          <Textarea
          ref={taRef}
          autoResize
          maxHeight={180}
          value={composerDraft(selectedSessionId())}
          onInput={(e) => {
            const el = e.currentTarget;
            setComposerDraft(selectedSessionId(), el.value);
            slash.onInputValue(el);
          }}
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
          aria-activedescendant={slash.slashMenuOpen() ? `${slashMenuId}-option-${slash.boundedActiveIndex()}` : undefined}
          aria-describedby={inputDescribedBy()}
          spellcheck={false}
          class="composer-input ui-scrollbar relative z-1 block w-full h-52 min-h-52 max-h-180 pt-14 px-16 pb-4 border-0 outline-0 resize-none overflow-y-auto bg-transparent text-text-primary text-14 leading-22 placeholder:text-text-muted disabled:bg-transparent disabled:text-text-secondary focus-visible:outline-0 max-narrow:px-15"
          />
        </div>
        <Show when={submissionForSession()}>{(submission) =>
          <InlineNotice
            id={submissionStatusId}
            class={`composer-submission composer-submission--${submission().phase} mt-2 mx-10 mb-8 border-dashed max-narrow:mx-8`}
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
            </div>
          </InlineNotice>
        }</Show>
        <div class="composer-toolbar flex min-h-44 items-center gap-5 px-10 pb-8 max-narrow:px-8">
          <IconButton label="Add attachment" title="Attachments are not connected yet" disabled class="composer-attachment size-32 min-h-32 shrink-0 border-0 bg-transparent text-text-primary disabled:opacity-55">
            <AttachmentIcon />
          </IconButton>
          <IconButton label="Approval mode" title="Approval mode is not connected yet" disabled class="composer-approval size-32 min-h-32 shrink-0 border-0 bg-transparent text-text-muted disabled:opacity-55">
            <ApprovalIcon />
          </IconButton>
          <Show when={prediction.activePrediction()}>
            <Button size="compact" variant="secondary" class="composer-prediction-action inline-flex min-h-30 items-center justify-center px-9 border-border-subtle bg-surface-muted text-text-secondary text-11 pointer-coarse:min-h-44 max-narrow:min-h-44" onClick={prediction.accept} aria-label="Use suggestion" title="Use suggestion (Tab)">
              <Icon class="size-16!"><path d="m4 10 3.5 3.5L16 5" /></Icon><kbd class="ml-3 px-4 py-2 border border-border-subtle rounded-4 bg-surface text-9 max-narrow:hidden">Tab</kbd>
            </Button>
          </Show>
          <Show when={canBrowseSkills()}>
            <Button
              size="compact"
              class="composer-skills relative inline-flex size-32 min-h-32 items-center justify-center gap-0 border-0 bg-transparent p-0 text-text-primary text-11 font-normal pointer-coarse:size-40 pointer-coarse:min-h-40 max-tight:before:content-['/'] max-tight:before:font-mono max-tight:before:text-15 max-tight:before:leading-none max-tight:before:font-bold"
              aria-expanded={slash.browseSkills() && slash.slashMenuOpen()}
              aria-controls={slashMenuId}
              aria-label={`Browse skills (${skillCount()})`}
              title={`Browse skills (${skillCount()})`}
              onClick={() => {
                slash.toggleBrowse(taRef);
                queueMicrotask(() => taRef?.focus());
              }}
              disabled={inputDisabled()}
            ><Icon class="size-17! max-tight:hidden" aria-hidden="true"><path d="M7 4H4v3M13 4h3v3M7 16H4v-3M13 16h3v-3" /><path d="M7 10h6M10 7v6" /></Icon><span class="composer-skills__count sr-only">{skillCount()}</span></Button>
          </Show>
          <span class="composer-shortcut sr-only" aria-hidden="true">Enter to send · Shift + Enter for newline</span>
          <div class="composer-toolbar__right ml-auto flex min-w-0 items-center gap-5">
          <Show when={latestUsage()}>{(usage) =>
            <TokenUsageMeter usage={usage()} />
          }</Show>
          <SessionModelMenu open={modelMenuOpen()} id={modelMenuId} onOpenChange={setModelMenuOpen} trigger={
            <Button
              size="compact"
              class="composer-runtime flex min-w-0 shrink items-center gap-6 overflow-hidden border-0 bg-transparent px-7 text-text-secondary text-11 leading-none text-ellipsis whitespace-nowrap"
              ref={modelTrigger}
              title={runtimeSummary()}
              aria-label={`${runtimeSummary()}, choose model`}
              disabled={!selectedCid() || !runtimeDocsHydrated()}
            ><span aria-hidden="true" class="size-6 flex-none rounded-full bg-success" />{model()}</Button>
          } />
          <span class="composer-voice-slot flex size-32 shrink-0 items-center justify-center">
            <IconButton label="Voice input" title="Voice input is not connected yet" disabled class="composer-voice size-32 min-h-32 shrink-0 border-0 bg-transparent text-text-primary disabled:opacity-55">
              <MicrophoneIcon />
            </IconButton>
          </span>
          <Show when={turnActive()} fallback={
            <span class="shrink-0"><IconButton tooltipPlacement="end" variant="primary" type="button" onClick={submit} disabled={inputDisabled() || !composerDraft(selectedSessionId()).trim()} label="Send" class="composer-action flex size-36 min-h-36 shrink-0 items-center justify-center border-0 rounded-full bg-btn-primary text-surface cursor-pointer hover:bg-btn-primary-hover disabled:cursor-not-allowed disabled:bg-border-subtle disabled:text-text-faint max-narrow:size-40 max-narrow:min-h-40">
              <Icon class="size-20"><path d="M10 16V4" /><path d="M5 9l5-5 5 5" /></Icon>
            </IconButton></span>
          }>
            <span class="shrink-0"><IconButton tooltipPlacement="end" variant="primary" type="button" onClick={requestCancel} disabled={cancelLocked() || readOnly()} busy={cancelControl()?.phase === 'sending' || cancelControl()?.phase === 'accepted'} label={cancelLabel()} class={`composer-action composer-action--stop flex size-36 min-h-36 shrink-0 items-center justify-center border-0 rounded-full bg-btn-primary text-surface cursor-pointer hover:bg-btn-primary-hover disabled:cursor-not-allowed disabled:bg-border-subtle disabled:text-text-faint max-narrow:size-40 max-narrow:min-h-40 ${cancelControl()?.phase === 'uncertain' ? 'bg-warning hover:bg-warning-strong' : ''}`}>
              <Show when={!cancelControl() || cancelControl()?.phase === 'uncertain' || cancelControl()?.phase === 'confirmed'}><span aria-hidden="true" class="size-10 rounded-2 bg-current" /></Show>
            </IconButton></span>
          </Show>
          </div>
        </div>
      </section>
      <Show when={submissionInAnotherSession()}>{(submission) =>
        <InlineNotice class="submission-state submission-state--foreign mt-10 mx-4 min-w-0 bg-surface-muted shadow-none max-narrow:flex-col" role="status" title="Another session is still confirming" tone="warning">
          <div class="submission-state__body min-w-0"><p class="mt-3">&quot;{pendingSessionTitle()}&quot; has a message awaiting a final server state. To avoid duplicate execution, no new messages are sent until it is confirmed.</p></div>
          <div class="submission-state__actions flex shrink-0 gap-4 max-narrow:w-full"><Button size="compact" class="max-narrow:first:flex-1" onClick={() => navigateProjectSession(submission().sessionId)}>Back to that session</Button></div>
        </InlineNotice>
      }</Show>
    </div>
  );
}
