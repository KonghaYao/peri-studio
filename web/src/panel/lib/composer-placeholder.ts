// Composer 输入可用性与 placeholder 决策（纯函数，P4 从 Composer 抽离）。
//
// 优先级顺序与原组件一致：只读 > 打开中 > 未选择会话 > 载入中 > 升级
// 提示 > 已结束 > 工作中/确认中 > 默认。工作中与确认中已有明确控件或异常面板，
// 不再用占位文案重复状态。

export interface ComposerPlaceholderInput {
  readOnly: boolean;
  openingSessionId: string | null;
  selectedCid: string | null;
  runtimeDocsHydrated: boolean;
  promptDeliveryReady: boolean;
  terminal: boolean;
  turnActive: boolean;
  submissionForSession: boolean;
}

export interface ComposerInputState {
  disabled: boolean;
  placeholder: string;
}

export function composerInputState(input: ComposerPlaceholderInput): ComposerInputState {
  const disabled = !input.selectedCid
    || !input.runtimeDocsHydrated
    || input.terminal
    || !!input.openingSessionId
    || input.readOnly
    || !input.promptDeliveryReady
    || input.turnActive
    || input.submissionForSession;
  let placeholder: string;
  if (input.readOnly) {
    placeholder = '';
  } else if (input.openingSessionId) {
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
    placeholder = 'Message Agent';
  }
  return { disabled, placeholder };
}
