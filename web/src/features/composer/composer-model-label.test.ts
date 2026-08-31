import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@/entities/chat/control-view';
import { composerModelLabel } from './composer-model-label';

const baseAgent = (): AgentInfo => ({
  instanceId: 'i',
  sessionId: 's',
  status: 'ready',
  lastActivityAt: null,
  availableCommands: [],
  commandCatalog: [],
  extensions: [],
  activities: [],
  inputPrediction: null,
  latestUsage: null,
  model: 'composer-2.5-fast',
  effort: null,
  contextWindow: null,
  contextUsed: null,
  configOptions: [
    {
      id: 'model',
      name: 'Model',
      description: null,
      category: 'model',
      currentValue: 'composer-2.5-fast',
      options: [
        { value: 'composer-2.5-fast', name: 'Composer 2.5 Fast', description: null },
        { value: 'sonnet', name: 'Claude Sonnet 4.6', description: null },
      ],
    },
  ],
});

describe('composerModelLabel', () => {
  it('prefers config option display name over raw model id', () => {
    expect(composerModelLabel(baseAgent())).toBe('Composer 2.5 Fast');
  });

  it('falls back to agent.model when config options are missing', () => {
    const agent = { ...baseAgent(), configOptions: undefined };
    expect(composerModelLabel(agent)).toBe('composer-2.5-fast');
  });

  it('respects pending mutation previous value for optimistic label', () => {
    expect(
      composerModelLabel(baseAgent(), { configId: 'model', previousValue: 'sonnet' }),
    ).toBe('Claude Sonnet 4.6');
  });
});
