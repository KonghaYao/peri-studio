import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/connection/connection', () => ({ connectionReady: () => true, promptDeliveryReady: () => true, promptMaxBytes: () => 1_000_000 }));
vi.mock('@/features/auth/auth-state', () => ({ readOnly: () => false }));
vi.mock('./panel-errors', () => ({ persistActionProblem: vi.fn(), retryPersistentAction: vi.fn() }));

import type { ActionOptions } from '@/shared/protocol/action-contract';
import { elicitationResponses, resetElicitationResponses } from '@/features/message/elicitation-delivery';
import { installUserActions, respondElicitation } from './user-actions';

describe('respondElicitation delivery lifecycle', () => {
  let options: ActionOptions | undefined;
  let sendResult: boolean;

  beforeEach(() => {
    resetElicitationResponses();
    options = undefined;
    sendResult = true;
    installUserActions({
      selectedCid: () => 'chat-1', openingSessionId: () => null, turnActive: () => false,
      currentCid: () => 'chat-1', selectedSessionId: () => 'session-1',
      composerDraftOwner: () => ({ principalId: 'principal-1', projectId: 'project-1', sessionId: 'session-1' }),
      chatStatusSignal: () => ({}),
      chatHead: () => null, sessionConfigMutation: () => null, setSessionConfigMutation: vi.fn(),
      toast: vi.fn(), sendAction: (_frame, _label, next) => { options = next; return sendResult; },
      hasUncertain: () => false, retry: () => null, reconcileCurrentRuntimeControl: vi.fn(),
    });
  });

  it('keeps DELIVERY_UNKNOWN locked under the original command identity', () => {
    respondElicitation('e1', 'accept', { answer: 'once' });
    const commandId = elicitationResponses().e1?.commandId;
    expect(commandId).toBeTruthy();
    expect(elicitationResponses().e1?.phase).toBe('pending');

    options?.onError?.({ commandId: commandId!, code: 'DELIVERY_UNKNOWN', message: 'unknown' });
    expect(elicitationResponses().e1).toMatchObject({ commandId, phase: 'delivery_unknown' });
    respondElicitation('e1', 'accept', { answer: 'twice' });
    expect(elicitationResponses().e1?.commandId).toBe(commandId);
  });

  it('marks timeout uncertain and keeps an exact terminal lock for projection reconciliation', () => {
    respondElicitation('e1', 'decline');
    const commandId = elicitationResponses().e1?.commandId;
    options?.onTimeout?.();
    expect(elicitationResponses().e1?.phase).toBe('uncertain');
    options?.cb?.({ commandId: 'another-command', status: 'committed' });
    expect(elicitationResponses()).toHaveProperty('e1');
    options?.cb?.({ commandId: commandId!, status: 'committed' });
    expect(elicitationResponses().e1).toMatchObject({ commandId, phase: 'confirmed' });
    respondElicitation('e1', 'decline');
    expect(elicitationResponses().e1?.commandId).toBe(commandId);
  });

  it('does not leave a local lock when transport rejects the send', () => {
    sendResult = false;
    respondElicitation('e1', 'cancel');
    expect(elicitationResponses()).toEqual({});
  });

  it('keeps a sent action error locked until the authority removes the elicitation', () => {
    respondElicitation('e1', 'accept', { answer: 'once' });
    const commandId = elicitationResponses().e1?.commandId;
    options?.onError?.({ commandId: commandId!, code: 'INVALID_STATE', message: 'rejected' });
    expect(elicitationResponses().e1).toMatchObject({ commandId, phase: 'failed' });
    respondElicitation('e1', 'accept', { answer: 'twice' });
    expect(elicitationResponses().e1?.commandId).toBe(commandId);
  });
});
