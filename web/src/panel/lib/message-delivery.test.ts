import { afterEach, describe, expect, it } from 'vitest';
import { composerDraft, setComposerDraft } from './composer-draft';
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
  reconcileMessageProjection,
  resetMessageDelivery,
  retryMessageDelivery,
  startMessageDelivery,
} from './message-delivery';

afterEach(resetMessageDelivery);

describe('message delivery', () => {
  it('keeps an uncertain message in the outbox instead of duplicating it into the editor', () => {
    setComposerDraft('session-a', 'important work');
    startMessageDelivery('cmd-a', 'important work', 'session-a', 'chat-a');
    expect(composerDraft('session-a')).toBe('');
    markMessageDeliveryUncertain('cmd-a');
    expect(composerDraft('session-a')).toBe('');
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
    dismissFailedMessageDelivery();
    expect(messageSubmission()).toBeNull();
  });

  it('restores a failed message only when the user explicitly returns to editing', () => {
    startMessageDelivery('cmd-failed', 'recover me', 'session-a', 'chat-a');
    failMessageDelivery('cmd-failed', 'rejected');
    expect(composerDraft('session-a')).toBe('');
    dismissFailedMessageDelivery();
    expect(composerDraft('session-a')).toBe('recover me');
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
    dismissFailedMessageDelivery();
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

    expect(acknowledgeUnknownMessageDelivery('unknown')).toBe(true);
    expect(messageSubmission()).toBeNull();
    expect(acknowledgedMessageDeliveries()).toEqual([]);
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
    expect(acknowledgeUnknownMessageDelivery('unknown-20')).toBe(true);
    expect(messageSubmission()).toBeNull();
    expect(acknowledgedMessageDeliveries()).toHaveLength(20);
  });

  it('refuses to replace an unresolved delivery even when a caller forgets the guard', () => {
    expect(startMessageDelivery('first', 'one', 'session-a', 'chat-a')).toBe(true);
    expect(startMessageDelivery('second', 'two', 'session-b', 'chat-b')).toBe(false);
    expect(messageSubmission()).toMatchObject({ commandId: 'first', sessionId: 'session-a', text: 'one' });
  });
});
