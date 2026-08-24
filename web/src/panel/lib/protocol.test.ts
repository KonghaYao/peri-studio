import { describe, expect, it } from 'vitest';
import { CAP_PROMPT_DELIVERY_V2, parse, resolvePermission, rewind, rewindCandidates, rewindPreview, subscribe, type PromptStatusItem } from './protocol';

describe('downstream protocol envelope parsing', () => {
  it('accepts a structurally valid known frame', () => {
    expect(parse('{"t":"ready","projectionVersions":{}}')).toEqual({
      t: 'ready', projectionVersions: {},
    });
  });

  it('keeps unknown string tags for forward-compatible store dispatch', () => {
    expect(parse('{"t":"future.capability","version":2}')).toEqual({
      t: 'future.capability', version: 2,
    });
  });

  it.each([
    ['ack with a numeric command identity', '{"t":"action_ack","commandId":7,"status":"committed"}'],
    ['ack with an unknown terminal status', '{"t":"action_ack","commandId":"c","status":"done"}'],
    ['ack with a numeric chat identity', '{"t":"action_ack","commandId":"c","status":"committed","chatId":7}'],
    ['error with a string retry flag', '{"t":"action_error","commandId":"c","code":"INVALID_STATE","message":"safe","retryable":"false"}'],
    ['Yjs update with invalid base64', '{"t":"ysync.update","doc":"hub:registry","update":"***"}'],
    ['Yjs update with an arbitrary document id', '{"t":"ysync.update","doc":"other:secret","update":"AAAA"}'],
    ['ready with nonnumeric projection version', '{"t":"ready","projectionVersions":{"hub:registry":"2"}}'],
    ['ready with an arbitrary document id', '{"t":"ready","projectionVersions":{"other:secret":2}}'],
  ])('rejects malformed known frame: %s', (_label, source) => {
    expect(parse(source)).toBeNull();
  });

  it('accepts exact wire shapes and preserves additive optional fields', () => {
    expect(parse('{"t":"action_ack","commandId":"c","status":"duplicate","sessionId":"s","chatId":"chat","futureField":true}'))
      .toMatchObject({ t: 'action_ack', commandId: 'c', status: 'duplicate', sessionId: 's', chatId: 'chat', futureField: true });
    expect(parse('{"t":"ysync.update","doc":"hub:registry","update":"AAAA","projectionVersion":2}'))
      .toEqual({ t: 'ysync.update', doc: 'hub:registry', update: 'AAAA', projectionVersion: 2 });
    expect(parse('{"t":"ysync.update","doc":"resource:view-1","update":"AAAA","projectionVersion":1}'))
      .toEqual({ t: 'ysync.update', doc: 'resource:view-1', update: 'AAAA', projectionVersion: 1 });
    expect(parse('{"t":"ysync.update","doc":"resource:view:escape","update":"AAAA"}')).toBeNull();
  });

  it('strictly decodes opaque resource view results', () => {
    expect(parse('{"t":"resource_result","requestId":"q1","result":{"kind":"view","data":{"viewId":"v1","docId":"resource:v1","leaseExpiresAt":"2026-08-23T00:00:00Z"}}}'))
      .toMatchObject({ t: 'resource_result', requestId: 'q1', result: { kind: 'view', data: { docId: 'resource:v1' } } });
    expect(parse('{"t":"resource_result","requestId":"q1","result":{"kind":"view","data":{"viewId":"v1","docId":"chat:secret","leaseExpiresAt":"x"}}}'))
      .toBeNull();
    expect(parse('{"t":"resource_result","requestId":"q1","result":{"kind":"view","data":{"viewId":"v1","docId":"resource:other","leaseExpiresAt":"x"}}}'))
      .toBeNull();
    expect(parse('{"t":"resource_result","requestId":"q1","result":{"kind":"view","data":{"viewId":"v1","docId":"resource:v1","leaseExpiresAt":"not-a-time"}}}'))
      .toBeNull();
    expect(parse('{"t":"resource_result","requestId":"q1","result":{"kind":"view","data":{"viewId":"v1","docId":"resource:v1","leaseExpiresAt":"2026-02-30T00:00:00Z"}}}'))
      .toBeNull();
    expect(parse('{"t":"resource_result","requestId":"q1","result":{"kind":"view","data":{"viewId":"v1","docId":"resource:v1","leaseExpiresAt":"2026-08-24T24:00:00Z"}}}'))
      .toBeNull();
    expect(parse('{"t":"resource_result","requestId":"q1","result":{"kind":"blob","data":{"blobId":"b1","url":"https://evil.example/file","expiresAt":"x"}}}'))
      .toBeNull();
    expect(parse('{"t":"resource_result","requestId":"q1","result":{"kind":"future"}}'))
      .toBeNull();
    expect(parse('{"t":"resource_result","requestId":"q1","error":{"code":"FORBIDDEN","message":"safe","retryable":false}}'))
      .toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('accepts null optional fields emitted by the Rust action terminal frames', () => {
    const ack = parse('{"t":"action_ack","commandId":"project-create","status":"committed","turnId":null,"chatId":null,"projectId":"project-1","sessionId":null,"acpSessionId":null,"committedProjectionVersion":null}');
    expect(ack).toMatchObject({
      t: 'action_ack',
      commandId: 'project-create',
      status: 'committed',
      projectId: 'project-1',
    });
    expect(ack).not.toHaveProperty('turnId');
    expect(ack).not.toHaveProperty('committedProjectionVersion');

    const error = parse('{"t":"action_error","commandId":"project-create","code":"INVALID_STATE","message":"safe","retryable":false,"retryAfterMs":null}');
    expect(error).toMatchObject({
      t: 'action_error',
      commandId: 'project-create',
      code: 'INVALID_STATE',
    });
    expect(error).not.toHaveProperty('retryAfterMs');

    const promptStatus = parse('{"t":"prompt_status","commandId":"query-1","sessionId":"session-1","runtimeRestored":false,"truncated":false,"evidenceIncomplete":false,"prompts":[{"commandId":"prompt-1","turnId":null,"status":"failed","createdAt":"2026-08-14T00:00:00Z","updatedAt":"2026-08-14T00:00:01Z","errorCode":null}]}');
    expect(promptStatus).toMatchObject({
      t: 'prompt_status',
      prompts: [{ commandId: 'prompt-1', status: 'failed' }],
    });
    expect((promptStatus as { prompts: PromptStatusItem[] }).prompts[0]).not.toHaveProperty('turnId');
  });

  it('declares prompt delivery capability and validates the negotiated echo', () => {
    expect(subscribe(['hub:registry'])).toEqual({
      t: 'ysync.subscribe',
      docs: ['hub:registry'],
      clientCapabilities: [CAP_PROMPT_DELIVERY_V2],
    });
    expect(parse('{"t":"ready","projectionVersions":{},"negotiatedCapabilities":["prompt-delivery-v2"],"maxPromptBytes":65536}'))
      .toMatchObject({ negotiatedCapabilities: [CAP_PROMPT_DELIVERY_V2], maxPromptBytes: 65536 });
    expect(parse('{"t":"ready","projectionVersions":{},"negotiatedCapabilities":[7]}')).toBeNull();
    expect(parse('{"t":"ready","projectionVersions":{},"maxPromptBytes":0}')).toBeNull();
    expect(parse('{"t":"ready","projectionVersions":{},"maxPromptBytes":1.5}')).toBeNull();
  });

  it('sends the exact projected option ID while keeping legacy omission compatible', () => {
    expect(resolvePermission('chat-1', 'permission-1', 'allow', 'opaque-session')).toMatchObject({
      type: 'permission/resolve',
      payload: {
        chatId: 'chat-1',
        permissionId: 'permission-1',
        decision: 'allow',
        optionId: 'opaque-session',
      },
    });
    expect(resolvePermission('chat-1', 'permission-1', 'deny').payload).not.toHaveProperty('optionId');
  });

  it('constructs the preview-bound rewind flow and strictly decodes safe results', () => {
    expect(rewindCandidates('chat-1')).toMatchObject({ type: 'chat/rewind-candidates', payload: { chatId: 'chat-1' } });
    expect(rewindPreview('chat-1', 'message-1')).toMatchObject({ type: 'chat/rewind-preview', payload: { chatId: 'chat-1', targetMessageId: 'message-1' } });
    expect(rewind('chat-1', 'message-1', 'a'.repeat(64))).toMatchObject({
      type: 'chat/rewind',
      payload: { chatId: 'chat-1', targetMessageId: 'message-1', previewFingerprint: 'a'.repeat(64), revertFiles: true },
    });
    expect(parse('{"t":"rewind_candidates","commandId":"q1","chatId":"chat-1","candidates":[{"messageId":"m1","preview":"first prompt"}]}'))
      .toMatchObject({ t: 'rewind_candidates', candidates: [{ messageId: 'm1' }] });
    expect(parse(`{"t":"rewind_preview","commandId":"q2","chatId":"chat-1","targetMessageId":"m1","previewFingerprint":"${'b'.repeat(64)}","fileChanges":[{"path":"src/main.rs","kind":"edit"}]}`))
      .toMatchObject({ t: 'rewind_preview', fileChanges: [{ path: 'src/main.rs', kind: 'edit' }] });
    expect(parse(`{"t":"rewind_preview","commandId":"q2","chatId":"chat-1","targetMessageId":"m1","previewFingerprint":"${'b'.repeat(64)}","fileChanges":[{"path":"../secret","kind":"edit"}]}`))
      .toBeNull();
    expect(parse('{"t":"rewind_candidates","commandId":"q1","chatId":"chat-1","candidates":[{"messageId":7,"preview":"bad"}]}'))
      .toBeNull();
  });

  it('keeps OAuth status safe and accepts the URL only on the dedicated frame', () => {
    expect(parse('{"t":"mcp_oauth","chatId":"chat-1","flowId":"flow-1","serverName":"github","status":"authorization_needed","updatedAt":"2026-08-15T00:00:00Z"}'))
      .toMatchObject({ t: 'mcp_oauth', flowId: 'flow-1', status: 'authorization_needed' });
    expect(parse('{"t":"mcp_oauth","chatId":"chat-1","flowId":"flow-1","serverName":"github","status":"authorization_needed","authorizationUrl":"https://example.test/oauth","updatedAt":"2026-08-15T00:00:00Z"}'))
      .toBeNull();
    expect(parse('{"t":"mcp_oauth_authorization","commandId":"command-1","chatId":"chat-1","flowId":"flow-1","authorizationUrl":"https://example.test/oauth?opaque=value","expiresAt":"2026-08-15T00:02:00Z"}'))
      .toMatchObject({ t: 'mcp_oauth_authorization', flowId: 'flow-1' });
    expect(parse('{"t":"mcp_oauth_authorization","commandId":"command-1","chatId":"chat-1","flowId":"flow-1","authorizationUrl":"http://example.test/oauth","expiresAt":"2026-08-15T00:02:00Z"}'))
      .toBeNull();
    expect(parse('{"t":"mcp_oauth_authorization","commandId":"command-1","chatId":"chat-1","flowId":"flow-1","authorizationUrl":"https://example.test/oauth","state":"secret","expiresAt":"2026-08-15T00:02:00Z"}'))
      .toBeNull();
  });

  it('decodes body-free prompt recovery evidence and rejects false runtime claims', () => {
    expect(parse('{"t":"prompt_status","commandId":"q1","sessionId":"s1","runtimeRestored":false,"truncated":false,"evidenceIncomplete":false,"prompts":[{"commandId":"p1","status":"delivery_unknown","createdAt":"2026-08-14T00:00:00Z","updatedAt":"2026-08-14T00:00:01Z"}]}'))
      .toMatchObject({ t: 'prompt_status', sessionId: 's1', runtimeRestored: false, prompts: [{ commandId: 'p1', status: 'delivery_unknown' }] });
    expect(parse('{"t":"prompt_status","commandId":"q1","sessionId":"s1","runtimeRestored":true,"truncated":false,"evidenceIncomplete":false,"prompts":[]}')).toBeNull();
    expect(parse('{"t":"prompt_status","commandId":"q1","sessionId":"s1","runtimeRestored":false,"truncated":false,"evidenceIncomplete":false,"prompts":[{"commandId":"p1","status":"completed","createdAt":"x","updatedAt":"x","message":"secret"}]}')).toBeNull();
    expect(parse('{"t":"prompt_status","commandId":"q1","sessionId":"s1","runtimeRestored":false,"truncated":false,"evidenceIncomplete":false,"prompts":[],"message":"secret"}')).toBeNull();
  });

  it.each([
    ['invalid JSON', '{'],
    ['null', 'null'],
    ['array', '[{"t":"ready"}]'],
    ['string primitive', '"ready"'],
    ['number primitive', '7'],
    ['missing tag', '{"projectionVersions":{}}'],
    ['non-string tag', '{"t":7}'],
    ['empty tag', '{"t":"  "}'],
  ])('rejects %s without throwing', (_label, source) => {
    expect(() => parse(source)).not.toThrow();
    expect(parse(source)).toBeNull();
  });
});
