import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentInputPredictionInfo, ControlView } from '@/entities/chat/control-view';
import { useComposerPrediction, type ComposerPredictionController } from './composer-prediction';

const prediction: AgentInputPredictionInfo = { id: 'prediction:1:7', text: 'failed check test', createdAt: '2026-08-15T00:00:00Z' };

function agent(extensions: string[] = ['peri.prediction'], inputPrediction: AgentInputPredictionInfo | null = prediction): ControlView['agent'] {
  return {
    instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
    availableCommands: [], commandCatalog: [], extensions, activities: [],
    inputPrediction, latestUsage: null, model: 'model', effort: 'high', contextWindow: 200_000, contextUsed: 42_000,
  };
}

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach((dispose) => dispose()); });

function setup(overrides: {
  agentValue?: ControlView['agent'] | null;
  draft?: string;
  sessionId?: string | null;
  inputDisabled?: boolean;
} = {}) {
  let draft = overrides.draft ?? '';
  const accepted: string[] = [];
  let controller!: ComposerPredictionController;
  createRoot((dispose) => {
    controller = useComposerPrediction({
      agent: () => overrides.agentValue ?? agent(),
      draft: () => draft,
      sessionId: () => overrides.sessionId ?? 'session-1',
      inputDisabled: () => overrides.inputDisabled ?? false,
      onAccept: (text) => { accepted.push(text); draft = text; },
    });
    disposers.push(dispose);
  });
  return { controller, accepted, setDraft: (value: string) => { draft = value; } };
}

describe('useComposerPrediction', () => {
  it('offers a negotiated prediction when the draft is empty', () => {
    const { controller } = setup();
    expect(controller.activePrediction()).toEqual(prediction);
  });

  it('stays hidden without exact negotiation', () => {
    const { controller } = setup({ agentValue: agent([]) });
    expect(controller.activePrediction()).toBeNull();
  });

  it('hides while the user is typing and restores when the draft clears', () => {
    const { controller, setDraft } = setup();
    setDraft('my own input');
    expect(controller.activePrediction()).toBeNull();
    setDraft('');
    expect(controller.activePrediction()).toEqual(prediction);
  });

  it('hides while input is disabled', () => {
    const { controller } = setup({ inputDisabled: true });
    expect(controller.activePrediction()).toBeNull();
  });

  it('dismisses only the exact session prediction', () => {
    const { controller } = setup({ sessionId: 'session-1' });
    controller.dismiss();
    expect(controller.activePrediction()).toBeNull();
  });

  it('re-offers the prediction in another session after a scoped dismiss', () => {
    setup({ sessionId: 'session-1' }).controller.dismiss();
    // 同一预测在另一会话中应重新出现（dismiss 键含 sessionId）
    const other = setup({ sessionId: 'session-2' });
    expect(other.controller.activePrediction()).toEqual(prediction);
  });

  it('accepts through the host callback and clears the offer', () => {
    const { controller, accepted } = setup();
    controller.accept();
    expect(accepted).toEqual(['failed check test']);
    expect(controller.activePrediction()).toBeNull();
  });

  it('accept without an active prediction is a no-op', () => {
    const { controller, accepted } = setup({ agentValue: agent([]) });
    controller.accept();
    controller.dismiss();
    expect(accepted).toHaveLength(0);
  });
});
