import { describe, expect, it } from 'vitest';
import { completeRewind, executingRewind, failRewind, loadingRewindCandidates, loadingRewindPreview, receiveRewindCandidates, receiveRewindPreview } from './rewind-flow';

const candidate = { messageId: 'message-1', preview: 'Fix login flow' };
const fingerprint = 'a'.repeat(64);

describe('rewind flow', () => {
  it('requires exact command, chat and target identities through all three stages', () => {
    const loading = loadingRewindCandidates('chat-1', 'candidates-1');
    expect(receiveRewindCandidates(loading, { commandId: 'late', chatId: 'chat-1', candidates: [candidate] })).toBe(loading);
    const selecting = receiveRewindCandidates(loading, { commandId: 'candidates-1', chatId: 'chat-1', candidates: [candidate] });
    const previewing = loadingRewindPreview(selecting, 'preview-1', candidate);
    expect(receiveRewindPreview(previewing, { commandId: 'preview-1', chatId: 'chat-1', targetMessageId: 'other', previewFingerprint: fingerprint, fileChanges: [] })).toBe(previewing);
    const confirm = receiveRewindPreview(previewing, { commandId: 'preview-1', chatId: 'chat-1', targetMessageId: 'message-1', previewFingerprint: fingerprint, fileChanges: [{ path: 'src/main.rs', kind: 'edit' }] });
    const executing = executingRewind(confirm, 'execute-1');
    expect(completeRewind(executing, 'other')).toBe(executing);
    expect(completeRewind(executing, 'execute-1')).toEqual({ kind: 'completed', chatId: 'chat-1' });
  });

  it('turns ambiguous execution into a terminal no-retry state', () => {
    const selecting = receiveRewindCandidates(loadingRewindCandidates('chat-1', 'q1'), { commandId: 'q1', chatId: 'chat-1', candidates: [candidate] });
    const previewing = loadingRewindPreview(selecting, 'q2', candidate);
    const confirm = receiveRewindPreview(previewing, { commandId: 'q2', chatId: 'chat-1', targetMessageId: 'message-1', previewFingerprint: fingerprint, fileChanges: [] });
    const executing = executingRewind(confirm, 'x1');
    expect(failRewind(executing, 'x1', 'DELIVERY_UNKNOWN', 'Unknown result')).toEqual({
      kind: 'delivery_unknown', chatId: 'chat-1', detail: 'Unknown result',
    });
  });
});
