import { afterEach, describe, expect, it } from 'vitest';
import { composerDraft, setComposerDraft } from '@/features/composer/composer-draft';
import {
  acknowledgeUnknownMessageDelivery,
  acknowledgedMessageDeliveries,
  acceptMessageDelivery,
  blockUnknownMessageDelivery,
  completeMessageDelivery,
  dismissFailedMessageDelivery,
  failMessageDelivery,
  markMessageDeliveryUncertain,
  messageSubmission,
  ownsMessageDeliveryError,
  reconcileMessageProjection,
  resetMessageDelivery,
  retryMessageDelivery,
  settleProjectedMessageDelivery,
  startMessageDelivery,
} from './message-delivery';

afterEach(resetMessageDelivery);

describe('message delivery', () => {
  it('persists an uncertain message draft while keeping it locked in the outbox', () => {
    setComposerDraft('session-a', 'important work');
    startMessageDelivery('cmd-a', 'important work', 'session-a', 'chat-a');
    expect(composerDraft('session-a')).toBe('');
    markMessageDeliveryUncertain('cmd-a');
    expect(composerDraft('session-a')).toBe('important work');
    expect(messageSubmission()).toMatchObject({ phase: 'uncertain', retryable: true });
  });

  it('keeps a committed outbox item until its exact durable projection arrives', () => {
    startMessageDelivery('cmd-a', 'source', 'session-a', 'chat-a');
    acceptMessageDelivery('other');
    expect(messageSubmission()?.phase).toBe('sending');
    expect(completeMessageDelivery('other', 'committed')).toBe(false);
    expect(completeMessageDelivery('cmd-a', 'accepted')).toBe(false);
    expect(completeMessageDelivery('cmd-a', 'duplicate')).toBe(true);
    expect(messageSubmission()?.phase).toBe('committed');
    expect(reconcileMessageProjection(new Set(['other']))).toBe(false);
    expect(messageSubmission()?.commandId).toBe('cmd-a');
    expect(reconcileMessageProjection(new Set(['cmd-a']))).toBe(true);
    expect(messageSubmission()).toBeNull();
  });

  it('uses projection and terminal acknowledgement as independent release barriers', () => {
    startMessageDelivery('cmd-a', 'source', 'session-a', 'chat-a');
    expect(reconcileMessageProjection(new Set(['cmd-a']))).toBe(true);
    expect(messageSubmission()).toMatchObject({ commandId: 'cmd-a', projected: true });
    expect(completeMessageDelivery('cmd-a', 'committed')).toBe(true);
    expect(messageSubmission()).toBeNull();
  });

  it('does not restore a projected message when the terminal action reports an error', () => {
    startMessageDelivery('cmd-a', 'source', 'session-a', 'chat-a');
    reconcileMessageProjection(new Set(['cmd-a']));
    failMessageDelivery('cmd-a', 'agent rejected');
    expect(messageSubmission()).toBeNull();
    expect(composerDraft('session-a')).toBe('');
  });

  it('isolates drafts by durable session and never overwrites newer user edits', () => {
    setComposerDraft('session-a', 'original');
    setComposerDraft('session-b', 'private b');
    startMessageDelivery('cmd-a', 'original', 'session-a', 'chat-a');
    setComposerDraft('session-a', 'newer edit');
    failMessageDelivery('cmd-a', 'rejected');
    expect(composerDraft('session-a')).toBe('newer edit');
    expect(composerDraft('session-b')).toBe('private b');
    dismissFailedMessageDelivery('cmd-a');
    expect(messageSubmission()).toBeNull();
  });

  it('can reset runtime delivery state without deleting a refresh-restorable draft', () => {
    setComposerDraft('session-a', 'persist across cookie validation');
    startMessageDelivery('cmd-b', 'pending elsewhere', 'session-b', 'chat-b');

    resetMessageDelivery(true);

    expect(messageSubmission('session-b')).toBeNull();
    expect(composerDraft('session-a')).toBe('persist across cookie validation');
  });

  it('persists a failed message and returns it to editing only on explicit dismissal', () => {
    startMessageDelivery('cmd-failed', 'recover me', 'session-a', 'chat-a');
    failMessageDelivery('cmd-failed', 'rejected');
    expect(composerDraft('session-a')).toBe('recover me');
    dismissFailedMessageDelivery('cmd-failed');
    expect(composerDraft('session-a')).toBe('recover me');
  });

  it('clears only the exact restored draft after a terminal message outcome', () => {
    startMessageDelivery('cmd-a', 'original', 'session-a', 'chat-a');
    markMessageDeliveryUncertain('cmd-a');
    expect(composerDraft('session-a')).toBe('original');
    completeMessageDelivery('cmd-a', 'committed');
    expect(composerDraft('session-a')).toBe('');

    startMessageDelivery('cmd-b', 'second', 'session-b', 'chat-b');
    markMessageDeliveryUncertain('cmd-b');
    setComposerDraft('session-b', 'newer local text');
    completeMessageDelivery('cmd-b', 'duplicate');
    expect(composerDraft('session-b')).toBe('newer local text');
  });

  it('never reconciles equal text without the exact command identity', () => {
    startMessageDelivery('cmd-a', 'same text', 'session-a', 'chat-a');
    completeMessageDelivery('cmd-a', 'committed');
    expect(reconcileMessageProjection(new Set())).toBe(false);
    expect(messageSubmission()).not.toBeNull();
  });

  it('preserves identity across a same-command retry', () => {
    startMessageDelivery('stable', 'source', 'session-a', 'chat-a');
    markMessageDeliveryUncertain('stable');
    retryMessageDelivery('stable');
    expect(messageSubmission()).toMatchObject({ commandId: 'stable', phase: 'sending', text: 'source' });
  });

  it('blocks server delivery-unknown without restoring or retrying the text', () => {
    startMessageDelivery('unknown', 'may have executed', 'session-a', 'chat-a');
    markMessageDeliveryUncertain('unknown');
    blockUnknownMessageDelivery('unknown');
    expect(messageSubmission()).toMatchObject({
      commandId: 'unknown', phase: 'delivery_unknown', retryable: false,
    });
    expect(composerDraft('session-a')).toBe('');
    dismissFailedMessageDelivery('unknown');
    expect(messageSubmission()?.phase).toBe('delivery_unknown');
    expect(composerDraft('session-a')).toBe('');
  });

  it('archives an acknowledged delivery-unknown and frees the active submission slot', () => {
    startMessageDelivery('unknown', 'may have executed', 'session-a', 'chat-a');
    blockUnknownMessageDelivery('unknown');

    expect(acknowledgeUnknownMessageDelivery('unknown')).toBe(true);
    expect(messageSubmission()).toBeNull();
    expect(acknowledgedMessageDeliveries()).toEqual([
      expect.objectContaining({ commandId: 'unknown', phase: 'delivery_unknown', text: 'may have executed' }),
    ]);
    expect(startMessageDelivery('next', 'continue safely', 'session-b', 'chat-b')).toBe(true);
  });

  it('removes archived uncertainty only when its exact durable projection arrives', () => {
    startMessageDelivery('unknown', 'may have executed', 'session-a', 'chat-a');
    blockUnknownMessageDelivery('unknown');
    acknowledgeUnknownMessageDelivery('unknown');

    expect(reconcileMessageProjection(new Set(['other']))).toBe(false);
    expect(acknowledgedMessageDeliveries()).toHaveLength(1);
    expect(reconcileMessageProjection(new Set(['unknown']))).toBe(true);
    expect(acknowledgedMessageDeliveries()).toEqual([]);
  });

  it('does not duplicate unknown evidence when the exact Chat Doc entry already exists', () => {
    startMessageDelivery('unknown', 'may have executed', 'session-a', 'chat-a');
    reconcileMessageProjection(new Set(['unknown']));
    blockUnknownMessageDelivery('unknown');

    expect(acknowledgeUnknownMessageDelivery('unknown')).toBe(false);
    expect(messageSubmission()).toBeNull();
    expect(acknowledgedMessageDeliveries()).toEqual([]);
  });

  it('releases a delivery-unknown gate when its exact projection arrives afterward', () => {
    startMessageDelivery('unknown-late-projection', 'recoverable text', 'session-a', 'chat-a');
    markMessageDeliveryUncertain('unknown-late-projection');
    blockUnknownMessageDelivery('unknown-late-projection');
    // 模拟刷新恢复出的同属草稿；精确投影必须一并清除，避免重复发送。
    setComposerDraft('session-a', 'recoverable text');

    expect(reconcileMessageProjection(new Set(['unknown-late-projection']))).toBe(true);
    expect(messageSubmission('session-a')).toBeNull();
    expect(composerDraft('session-a')).toBe('');
  });

  it('releases an uncertain gate directly when the exact projection wins the race', () => {
    startMessageDelivery('uncertain-late-projection', 'recoverable text', 'session-a', 'chat-a');
    markMessageDeliveryUncertain('uncertain-late-projection');

    expect(reconcileMessageProjection(new Set(['uncertain-late-projection']))).toBe(true);
    expect(messageSubmission('session-a')).toBeNull();
    expect(composerDraft('session-a')).toBe('');
  });

  it('does not lock the composer when exact durable projection already proves delivery', () => {
    startMessageDelivery('projected', 'already visible', 'session-a', 'chat-a');
    reconcileMessageProjection(new Set(['projected']));

    expect(ownsMessageDeliveryError('projected', 'DELIVERY_UNKNOWN')).toBe(true);
    blockUnknownMessageDelivery('projected');

    expect(messageSubmission()).toBeNull();
    expect(acknowledgedMessageDeliveries()).toEqual([]);
  });

  it('continues to own a delivery-unknown that arrives after projected uncertainty was released', () => {
    startMessageDelivery('projected-after-timeout', 'already visible', 'session-a', 'chat-a');
    markMessageDeliveryUncertain('projected-after-timeout');
    reconcileMessageProjection(new Set(['projected-after-timeout']));

    expect(messageSubmission()).toBeNull();
    expect(ownsMessageDeliveryError('projected-after-timeout', 'DELIVERY_UNKNOWN')).toBe(true);
    blockUnknownMessageDelivery('projected-after-timeout');
    expect(messageSubmission()).toBeNull();
  });

  it('bounds projected command ownership without retaining stale identities forever', () => {
    for (let index = 0; index < 65; index += 1) {
      const commandId = `projected-${index}`;
      startMessageDelivery(commandId, 'visible', `session-${index}`, `chat-${index}`);
      markMessageDeliveryUncertain(commandId);
      reconcileMessageProjection(new Set([commandId]));
    }

    expect(ownsMessageDeliveryError('projected-0', 'DELIVERY_UNKNOWN')).toBe(false);
    expect(ownsMessageDeliveryError('projected-1', 'DELIVERY_UNKNOWN')).toBe(true);
    expect(ownsMessageDeliveryError('projected-64', 'DELIVERY_UNKNOWN')).toBe(true);
  });

  it('does not let completed projected commands evict unresolved ownership', () => {
    startMessageDelivery('unresolved', 'visible', 'session-unresolved', 'chat-unresolved');
    markMessageDeliveryUncertain('unresolved');
    reconcileMessageProjection(new Set(['unresolved']));

    for (let index = 0; index < 64; index += 1) {
      const commandId = `completed-${index}`;
      startMessageDelivery(commandId, 'done', `session-completed-${index}`, `chat-completed-${index}`);
      reconcileMessageProjection(new Set([commandId]));
      completeMessageDelivery(commandId, 'committed');
    }

    expect(ownsMessageDeliveryError('unresolved', 'DELIVERY_UNKNOWN')).toBe(true);
  });

  it('settles projected ownership when a late terminal result finally arrives', () => {
    startMessageDelivery('late-terminal', 'visible', 'session-a', 'chat-a');
    markMessageDeliveryUncertain('late-terminal');
    reconcileMessageProjection(new Set(['late-terminal']));

    expect(ownsMessageDeliveryError('late-terminal', 'DELIVERY_UNKNOWN')).toBe(true);
    expect(completeMessageDelivery('late-terminal', 'committed')).toBe(false);
    expect(ownsMessageDeliveryError('late-terminal', 'DELIVERY_UNKNOWN')).toBe(false);
  });

  it('does not let resolved timeout flows evict a currently unresolved command', () => {
    startMessageDelivery('still-unresolved', 'visible', 'session-unresolved', 'chat-unresolved');
    markMessageDeliveryUncertain('still-unresolved');
    reconcileMessageProjection(new Set(['still-unresolved']));

    for (let index = 0; index < 64; index += 1) {
      const commandId = `resolved-timeout-${index}`;
      startMessageDelivery(commandId, 'visible', `session-${index}`, `chat-${index}`);
      markMessageDeliveryUncertain(commandId);
      reconcileMessageProjection(new Set([commandId]));
      completeMessageDelivery(commandId, 'duplicate');
    }

    expect(ownsMessageDeliveryError('still-unresolved', 'DELIVERY_UNKNOWN')).toBe(true);
    settleProjectedMessageDelivery('still-unresolved');
    expect(ownsMessageDeliveryError('still-unresolved', 'DELIVERY_UNKNOWN')).toBe(false);
  });

  it('fails closed instead of evicting unresolved evidence after twenty deliveries', () => {
    for (let index = 0; index < 20; index += 1) {
      const commandId = `unknown-${index}`;
      startMessageDelivery(commandId, `message-${index}`, `session-${index}`, `chat-${index}`);
      blockUnknownMessageDelivery(commandId);
      expect(acknowledgeUnknownMessageDelivery(commandId)).toBe(true);
    }

    startMessageDelivery('unknown-20', 'message-20', 'session-20', 'chat-20');
    blockUnknownMessageDelivery('unknown-20');
    expect(acknowledgeUnknownMessageDelivery('unknown-20')).toBe(false);
    expect(acknowledgedMessageDeliveries()).toHaveLength(20);
    expect(acknowledgedMessageDeliveries()[0]?.commandId).toBe('unknown-0');
    expect(acknowledgedMessageDeliveries()[19]?.commandId).toBe('unknown-19');
    expect(messageSubmission()?.commandId).toBe('unknown-20');
    reconcileMessageProjection(new Set(['unknown-20']));
    expect(acknowledgeUnknownMessageDelivery('unknown-20')).toBe(false);
    expect(messageSubmission()).toBeNull();
    expect(acknowledgedMessageDeliveries()).toHaveLength(20);
  });

  it('allows independent sessions while preserving one unresolved delivery per session', () => {
    expect(startMessageDelivery('first', 'one', 'session-a', 'chat-a')).toBe(true);
    expect(startMessageDelivery('second', 'two', 'session-b', 'chat-b')).toBe(true);
    expect(startMessageDelivery('duplicate-slot', 'three', 'session-a', 'chat-a')).toBe(false);
    expect(messageSubmission('session-a')).toMatchObject({ commandId: 'first', text: 'one' });
    expect(messageSubmission('session-b')).toMatchObject({ commandId: 'second', text: 'two' });
  });
});
