import { describe, expect, it } from 'vitest';
import { mapPutHttpStatusToUploadError, mapResourceFailureToUploadError } from './upload-errors';

describe('upload-errors', () => {
  it('maps resource failures to safe English copy', () => {
    expect(mapResourceFailureToUploadError({
      code: 'VERSION_CONFLICT',
      message: 'safe',
      retryable: false,
    }).message).toBe('A file with this name already exists.');

    expect(mapResourceFailureToUploadError({
      code: 'UPLOAD_EXPIRED',
      message: 'safe',
      retryable: true,
    }).retryable).toBe(true);
  });

  it('maps PUT HTTP statuses without leaking internals', () => {
    expect(mapPutHttpStatusToUploadError(413).code).toBe('UPLOAD_TOO_LARGE');
    expect(mapPutHttpStatusToUploadError(401).message).toMatch(/permission/i);
  });
});
