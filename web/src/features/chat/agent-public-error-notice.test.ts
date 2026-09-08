import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@/entities/chat/control-view';
import type { ChatEntry } from '@/entities/chat/chat-view';
import { selectAgentPublicErrorNotice } from './agent-public-error-notice';

const agent = (publicError: AgentInfo['publicError']): AgentInfo => ({
  instanceId: null,
  sessionId: null,
  status: 'error',
  lastActivityAt: null,
  availableCommands: [],
  commandCatalog: [],
  extensions: [],
  activities: [],
  inputPrediction: null,
  latestUsage: null,
  model: null,
  effort: null,
  contextWindow: null,
  contextUsed: null,
  publicError,
});

const assistant = (overrides: Partial<ChatEntry> = {}): ChatEntry => ({
  id: 't1:assistant',
  turnId: 't1',
  kind: 'message',
  role: 'assistant',
  status: 'error',
  authorUserId: null,
  sourceCommandId: null,
  origin: 'live',
  replayVerified: null,
  createdAt: '2026-08-14T00:00:00Z',
  completedAt: '2026-08-14T00:00:01Z',
  text: 'partial',
  blocks: [],
  reasoning: [],
  toolCalls: [],
  resources: [],
  error: null,
  ...overrides,
});

describe('selectAgentPublicErrorNotice', () => {
  it('returns agent error when turn idle and assistant entry has no error', () => {
    expect(selectAgentPublicErrorNotice(
      agent({ code: 'RATE_LIMITED', message: 'try later' }),
      false,
      [assistant()],
    )).toEqual({ code: 'RATE_LIMITED', message: 'try later' });
  });

  it('hides while turn is active', () => {
    expect(selectAgentPublicErrorNotice(
      agent({ code: 'AGENT_ERROR', message: 'x' }),
      true,
      [],
    )).toBeNull();
  });

  it('hides when latest assistant entry already carries error', () => {
    expect(selectAgentPublicErrorNotice(
      agent({ code: 'AGENT_ERROR', message: 'x' }),
      false,
      [assistant({ error: { code: 'TOOL_FAILED', message: 'y' } })],
    )).toBeNull();
  });
});
