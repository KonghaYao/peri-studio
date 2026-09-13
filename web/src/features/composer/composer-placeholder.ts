// Composer 输入可用性与 placeholder 决策（纯函数，P4 从 Composer 抽离）。
//
// 输入框永不禁用：发送后、turn 进行中、打开/载入中都可以继续打草稿。
// 发送由 sendLocked 门禁（Stop / 确认面板 / 会话未就绪），不靠禁用 textarea。
//
// placeholder 优先级：只读（静默）> 打开中（仅当前 session）> 未选择会话 >
// 载入中 > 升级提示 > 已结束 > 工作中/确认中（空，避免重复状态）> 默认。

export interface ComposerPlaceholderInput {
  readOnly: boolean;
  openingSessionId: string | null;
  selectedSessionId: string | null;
  selectedCid: string | null;
  runtimeDocsHydrated: boolean;
  promptDeliveryReady: boolean;
  terminal: boolean;
  turnActive: boolean;
  submissionForSession: boolean;
}

/** opening 只锁正在打开的那条 session；旁路 live runtime 必须仍可输入。 */
export function isOpeningSelectedSession(
  openingSessionId: string | null,
  selectedSessionId: string | null,
): boolean {
  return !!openingSessionId && (!selectedSessionId || openingSessionId === selectedSessionId);
}

export interface ComposerInputState {
  /** 当前 turn、本会话提交中或会话未就绪：不可发送。 */
  sendLocked: boolean;
  /** 会话已就绪、可宣称发送；预测等建议面用，不锁输入框。 */
  composerReady: boolean;
  placeholder: string;
}

export function composerInputState(input: ComposerPlaceholderInput): ComposerInputState {
  const openingCurrent = isOpeningSelectedSession(input.openingSessionId, input.selectedSessionId);
  const sessionBlocked = !input.selectedCid
    || !input.runtimeDocsHydrated
    || input.terminal
    || openingCurrent
    || input.readOnly
    || !input.promptDeliveryReady;
  const sendLocked = sessionBlocked || input.turnActive || input.submissionForSession;
  let placeholder: string;
  if (input.readOnly) {
    placeholder = '';
  } else if (openingCurrent) {
    placeholder = 'Opening session…';
  } else if (!input.selectedCid) {
    placeholder = 'Select or create a session from the left first';
  } else if (!input.runtimeDocsHydrated) {
    placeholder = 'Loading session…';
  } else if (!input.promptDeliveryReady) {
    placeholder = 'Server upgrade required to send messages safely';
  } else if (input.terminal) {
    placeholder = 'Conversation ended (history is read-only)';
  } else if (input.turnActive || input.submissionForSession) {
    placeholder = '';
  } else {
    placeholder = 'Message the agent, or type / for commands';
  }
  return { sendLocked, composerReady: !sessionBlocked, placeholder };
}
