import { describe, expect, it } from 'vitest';
import {
  fsWriteFileAction,
  isResourceResult,
  openResourceUpload,
} from './resource-protocol';

describe('resource-protocol upload segment', () => {
  it('builds resource/open-upload without root field', () => {
    const frame = openResourceUpload('project-1', { path: 'docs/readme.md', expectedBytes: 12 });
    expect(frame.t).toBe('resource_query');
    expect(frame.type).toBe('resource/open-upload');
    expect(frame.projectId).toBe('project-1');
    expect(frame.payload.path).toBe('docs/readme.md');
    expect(frame.payload.expectedBytes).toBe(12);
    expect(Object.hasOwn(frame, 'root')).toBe(false);
  });

  it('builds fs/write-file with create-only ifNoneMatch', () => {
    const frame = fsWriteFileAction('cmd-1', 'project-1', 'notes.txt', 'upload-1');
    expect(frame.t).toBe('action');
    expect(frame.type).toBe('fs/write-file');
    expect(frame.commandId).toBe('cmd-1');
    expect(frame.payload.ifNoneMatch).toBe('*');
    expect(frame.payload.uploadId).toBe('upload-1');
  });

  it('validates upload resource_result envelopes', () => {
    expect(isResourceResult({
      t: 'resource_result',
      requestId: 'req-1',
      result: {
        kind: 'upload',
        data: {
          uploadId: 'upload-1',
          url: '/api/resource-uploads/upload-1',
          expiresAt: '2026-09-06T12:00:00Z',
        },
      },
    })).toBe(true);
    expect(isResourceResult({
      t: 'resource_result',
      requestId: 'req-1',
      result: {
        kind: 'upload',
        data: {
          uploadId: 'upload-1',
          url: 'https://evil.example/upload',
          expiresAt: '2026-09-06T12:00:00Z',
        },
      },
    })).toBe(false);
  });
});
