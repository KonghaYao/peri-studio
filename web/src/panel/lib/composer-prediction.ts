// Composer 输入预测（P4 从 Composer 拆出）。
//
// agent inputPrediction 的展示决策：协商了 peri.prediction、草稿为空、
// 输入可用、且该 (session, prediction) 未被 dismiss 时给出预测。`accept`
// 通过 `onAccept` 回调写草稿并聚焦，dismiss 只记录精确键。

import { createSignal } from 'solid-js';
import type { ControlView } from './control-view';

export interface ComposerPredictionOptions {
  /** 当前 chatHead 的 agent（协商字段来源）。 */
  agent: () => ControlView['agent'] | null;
  /** 当前会话草稿。 */
  draft: () => string;
  /** 当前会话 id（dismiss 键的一部分）。 */
  sessionId: () => string | null;
  /** 输入是否可用（inputDisabled）。 */
  inputDisabled: () => boolean;
  /** 接受预测：写草稿、更新 caret 并聚焦。 */
  onAccept: (text: string) => void;
}

export function useComposerPrediction(options: ComposerPredictionOptions) {
  const [dismissedPredictionKey, setDismissedPredictionKey] = createSignal<string | null>(null);

  const activePrediction = () => {
    const agent = options.agent();
    const prediction = agent?.extensions.includes('peri.prediction')
      ? agent.inputPrediction
      : null;
    const sessionId = options.sessionId();
    if (!prediction || !sessionId || options.inputDisabled() || options.draft() !== '') return null;
    return dismissedPredictionKey() === `${sessionId}:${prediction.id}` ? null : prediction;
  };

  function accept() {
    const prediction = activePrediction();
    if (!prediction) return;
    options.onAccept(prediction.text);
  }

  function dismiss() {
    const prediction = activePrediction();
    const sessionId = options.sessionId();
    if (prediction && sessionId) setDismissedPredictionKey(`${sessionId}:${prediction.id}`);
  }

  return { activePrediction, accept, dismiss };
}

export type ComposerPredictionController = ReturnType<typeof useComposerPrediction>;
