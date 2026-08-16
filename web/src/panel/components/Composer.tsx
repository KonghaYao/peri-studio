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

import { createSignal, Show } from 'solid-js';
import { cancelTurn, chatHead, chatStatusSignal, navigateProjectSession, openingSessionId, projectSessions, retryPersistentAction, runtimeDocsHydrated, selectedCid, selectedSessionId, sendMessage, turnActive } from '../store';
import { isTerminal } from '../lib/action-state';
import { promptDeliveryReady } from '../lib/connection';
import { readOnly } from '../lib/auth-state';
import { composerDraft, setComposerDraft } from '../lib/composer-draft';
import { messageSubmission } from '../lib/message-delivery';
import { runtimeControlFor } from '../lib/runtime-control';
import { composerInputState } from '../lib/composer-placeholder';
import { useComposerPrediction } from '../lib/composer-prediction';
import { useComposerSlash } from '../lib/composer-slash';
import { Button, Icon, IconButton, Textarea } from '../../ui';
import { SlashMenu } from './SlashMenu';
import { SessionConfigDialog } from './SessionConfigDialog';

/** tokens 数值 → "12k"/"200k" 缩写（>=1000 取 k；非法值 → null）。 */
function fmtTokens(n: number | null): string | null {
  if (n === null) return null;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function Composer() {
  let taRef: HTMLTextAreaElement | undefined;
  const slashMenuId = 'composer-slash-menu';
  const [configOpen, setConfigOpen] = createSignal(false);
  const submissionForSession = () => messageSubmission()?.sessionId === selectedSessionId() ? messageSubmission() : null;
  const submissionInAnotherSession = () => messageSubmission() && !submissionForSession() ? messageSubmission() : null;
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
  const preciseUsage = () => {
    const agent = chatHead()?.agent;
    if (!agent?.extensions.includes('peri.tokenStats')) return null;
    const usage = agent.latestUsage;
    if (!usage || usage.inputTokens === null || usage.outputTokens === null) return null;
    const cache = usage.cacheReadTokens === null ? '' : ` · Cached ${fmtTokens(usage.cacheReadTokens)}`;
    return `Input ${fmtTokens(usage.inputTokens)} · Output ${fmtTokens(usage.outputTokens)}${cache}`;
  };
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
    <div class="composer-wrap relative box-border w-full max-w-(--container-composer) mx-auto px-20 pb-20 desk:max-w-(--container-composer) desk:px-18 wide:max-w-(--container-composer) wide:px-20 max-desk:max-w-(--container-composer) max-narrow:px-10 max-narrow:pb-safe">
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
        aria-disabled={inputDisabled()}
        class="composer-surface overflow-hidden border border-composer-border rounded-24 bg-surface shadow-float focus-within:border-border-strong focus-within:shadow-float max-narrow:rounded-20"
      >
        <div class="composer-editor relative">
          <Show when={prediction.activePrediction()}>{(prediction) => <>
            <span class="composer-prediction absolute z-0 top-17 right-18 left-18 overflow-hidden text-text-faint text-15 leading-24 pointer-events-none text-ellipsis whitespace-nowrap max-narrow:top-15 max-narrow:right-15 max-narrow:left-15" aria-hidden="true">{prediction().text}</span>
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
            if (e.isComposing) return; // IME 组合确认回车不误发
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
          aria-describedby={prediction.activePrediction() ? 'composer-prediction-description' : undefined}
          spellcheck={false}
          class="composer-input ui-scrollbar relative z-1 block w-full h-58 min-h-58 max-h-180 pt-17 px-18 pb-7 border-0 outline-0 resize-none overflow-y-auto bg-transparent text-text-primary text-15 leading-24 placeholder:text-text-muted disabled:bg-transparent disabled:text-text-secondary focus-visible:outline-0 max-narrow:min-h-54 max-narrow:pt-15 max-narrow:px-15 max-narrow:pb-5"
          />
        </div>
        <div class="composer-toolbar flex min-h-48 items-center gap-9 pt-2 pr-8 pb-7 pl-10 max-narrow:min-h-46 max-narrow:pt-1 max-narrow:pr-6 max-narrow:pb-5 max-narrow:pl-12">
          <Show when={prediction.activePrediction()}>
            <Button size="compact" class="composer-prediction-action min-h-30 px-9 border-border-subtle bg-surface-muted text-text-secondary text-11 pointer-coarse:min-h-44 max-narrow:min-h-44" onClick={prediction.accept}>
              Use suggestion <kbd class="ml-3 px-4 py-2 border border-border-subtle rounded-4 bg-surface text-9 max-narrow:hidden">Tab</kbd>
            </Button>
          </Show>
          <Show when={canBrowseSkills()}>
            <Button
              size="compact"
              class="composer-skills relative min-h-30 px-9 border-border-subtle bg-surface-muted text-text-primary text-11 font-680 pointer-coarse:min-h-44 max-tight:size-44 max-tight:min-w-44 max-tight:p-0 max-tight:text-0 max-tight:before:content-['/'] max-tight:before:font-mono max-tight:before:text-15 max-tight:before:leading-none max-tight:before:font-bold"
              aria-expanded={slash.browseSkills() && slash.slashMenuOpen()}
              aria-controls={slashMenuId}
              onClick={() => {
                slash.toggleBrowse(taRef);
                queueMicrotask(() => taRef?.focus());
              }}
              disabled={inputDisabled()}
            >Skills <span class="grid min-w-18 h-18 place-items-center rounded-full bg-surface text-text-secondary font-mono text-10 leading-none max-tight:absolute max-tight:translate-x-12 max-tight:-translate-y-10">{skillCount()}</span></Button>
          </Show>
          <Button
            size="compact"
            class="composer-runtime flex min-w-0 max-w-35p items-center gap-7 overflow-hidden text-text-secondary text-11 leading-none text-ellipsis whitespace-nowrap max-middle:max-w-40p max-tight:max-w-42p max-tight:mr-auto"
            title={runtimeSummary()}
            aria-label={`${runtimeSummary()}, open Agent session config`}
            onClick={() => setConfigOpen(true)}
            disabled={!selectedCid() || !runtimeDocsHydrated()}
          ><span aria-hidden="true" class="size-6 flex-none rounded-full bg-success" />{model()}</Button>
          <Show when={preciseUsage()}>{(usage) =>
            <span class="composer-usage min-w-0 overflow-hidden text-text-muted text-11 leading-none text-ellipsis whitespace-nowrap max-middle:ml-auto max-tight:hidden" title={`Latest model request: ${usage()}`}>{usage()}</span>
          }</Show>
          <span class="composer-shortcut ml-auto text-text-muted text-11 whitespace-nowrap max-middle:hidden" aria-hidden="true">Enter to send · Shift + Enter for newline</span>
          <Show when={turnActive()} fallback={
            <IconButton tooltipPlacement="end" variant="primary" type="button" onClick={submit} disabled={inputDisabled() || !composerDraft(selectedSessionId()).trim()} label="Send" class="composer-action flex size-40 ml-auto shrink-0 items-center justify-center border-0 rounded-full bg-btn-primary text-surface cursor-pointer hover:bg-btn-primary-hover disabled:cursor-not-allowed disabled:bg-border-subtle disabled:text-text-faint pointer-coarse:size-44">
              <Icon class="size-20"><path d="M10 16V4" /><path d="M5 9l5-5 5 5" /></Icon>
            </IconButton>
          }>
            <IconButton tooltipPlacement="end" variant="primary" type="button" onClick={requestCancel} disabled={cancelLocked() || readOnly()} busy={cancelControl()?.phase === 'sending' || cancelControl()?.phase === 'accepted'} label={cancelLabel()} class={`composer-action composer-action--stop ${cancelControl()?.phase === 'uncertain' ? 'composer-action--uncertain' : ''} flex size-40 ml-auto shrink-0 items-center justify-center border-0 rounded-full bg-btn-primary text-surface cursor-pointer hover:bg-btn-primary-hover disabled:cursor-not-allowed disabled:bg-border-subtle disabled:text-text-faint pointer-coarse:size-44`}>
              <Show when={!cancelControl() || cancelControl()?.phase === 'uncertain' || cancelControl()?.phase === 'confirmed'}><span aria-hidden="true" class="size-10 rounded-2 bg-current" /></Show>
            </IconButton>
          </Show>
        </div>
      </section>
      <Show when={submissionInAnotherSession()}>{(submission) =>
        <section class="submission-state submission-state--foreign flex items-start justify-between gap-16 mt-10 mx-4 px-14 py-12 border border-border-subtle rounded-14 bg-surface shadow-recovery text-13 max-narrow:flex-col" role="status">
          <div class="submission-state__body min-w-0"><strong class="text-13">Another session is still confirming</strong><p class="mt-3 text-text-secondary leading-145">"{pendingSessionTitle()}" has a message awaiting a final server state. To avoid duplicate execution, no new messages are sent until it is confirmed.</p></div>
          <div class="submission-state__actions flex shrink-0 gap-4 max-narrow:w-full"><Button size="compact" class="min-h-32 border-0 rounded-8 bg-transparent text-text-secondary cursor-pointer max-narrow:first:flex-1" onClick={() => navigateProjectSession(submission().sessionId)}>Back to that session</Button></div>
        </section>
      }</Show>
      <SessionConfigDialog open={configOpen()} onClose={() => setConfigOpen(false)} />
    </div>
  );
}
