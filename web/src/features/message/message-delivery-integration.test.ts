import { afterEach, describe, expect, it } from 'vitest';
import {
  completeMessageDelivery,
  messageSubmission,
  reconcileMessageProjection,
  resetMessageDelivery,
  startMessageDelivery,
} from './message-delivery';

/** G6：发送占位 → 持久投影 → outbox 释放（薄 integration，不启 server）。 */
afterEach(resetMessageDelivery);

describe('message delivery integration (G6)', () => {
  it('releases the outbox after durable projection and terminal acknowledgement', () => {
    startMessageDelivery('cmd-g6', 'hello', 'session-g6', 'chat-g6');
    expect(messageSubmission('session-g6')).toMatchObject({ phase: 'sending', projected: false });

    expect(reconcileMessageProjection(new Set(['cmd-g6']))).toBe(true);
    expect(messageSubmission('session-g6')).toMatchObject({ projected: true });

    expect(completeMessageDelivery('cmd-g6', 'committed')).toBe(true);
    expect(messageSubmission('session-g6')).toBeNull();
  });
});
