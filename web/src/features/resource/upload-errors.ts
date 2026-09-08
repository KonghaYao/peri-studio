import type { ResourceFailure } from './resource-protocol';

export interface UploadUserFacingError {
  message: string;
  retryable: boolean;
  code?: string;
}

/** resource_result / action 封闭错误码 → 英文可操作 copy（不泄露路径/token）。 */
export function mapResourceFailureToUploadError(failure: ResourceFailure): UploadUserFacingError {
  const code = failure.code;
  switch (code) {
    case 'FORBIDDEN':
    case 'PERMISSION_DENIED':
      return {
        message: 'You do not have permission to upload files to this project.',
        retryable: false,
        code,
      };
    case 'PROJECT_NOT_FOUND':
      return {
        message: 'This project is no longer available.',
        retryable: false,
        code,
      };
    case 'INSTANCE_OFFLINE':
    case 'UNAVAILABLE':
      return {
        message: 'The target machine is offline. Try again when it reconnects.',
        retryable: true,
        code,
      };
    case 'INVALID_PATH':
    case 'OUTSIDE_WORKSPACE':
      return {
        message: 'This upload path is not allowed.',
        retryable: false,
        code,
      };
    case 'UNREPRESENTABLE_NAME':
      return {
        message: 'This file name cannot be used on the remote workspace.',
        retryable: false,
        code,
      };
    case 'VERSION_CONFLICT':
      return {
        message: 'A file with this name already exists.',
        retryable: false,
        code,
      };
    case 'UPLOAD_TOO_LARGE':
      return {
        message: 'File exceeds 8 MB limit.',
        retryable: false,
        code,
      };
    case 'UPLOAD_EXPIRED':
      return {
        message: 'Upload ticket expired. Retry to start a new upload.',
        retryable: true,
        code,
      };
    case 'UPLOAD_CHECKSUM_MISMATCH':
      return {
        message: 'Upload checksum mismatch. Retry to upload again.',
        retryable: true,
        code,
      };
    case 'UPLOAD_ALREADY_CONSUMED':
    case 'UPLOAD_ALREADY_COMPLETE':
      return {
        message: 'Upload ticket is no longer valid. Retry to start a new upload.',
        retryable: true,
        code,
      };
    case 'RESOURCE_UNSUPPORTED':
      return {
        message: 'Upload is not supported on this machine yet.',
        retryable: false,
        code,
      };
    case 'RATE_LIMITED':
      return {
        message: 'Too many uploads in progress. Wait a moment and retry.',
        retryable: true,
        code,
      };
    case 'TIMEOUT':
    case 'DELIVERY_UNKNOWN':
      return {
        message: failure.message || 'Upload timed out. Retry when the connection is stable.',
        retryable: true,
        code,
      };
    default:
      return {
        message: failure.message || 'Upload failed. Try again.',
        retryable: failure.retryable,
        code,
      };
  }
}

export function mapPutHttpStatusToUploadError(status: number): UploadUserFacingError {
  switch (status) {
    case 401:
    case 403:
      return {
        message: 'You do not have permission to upload files.',
        retryable: false,
        code: 'FORBIDDEN',
      };
    case 404:
    case 410:
      return {
        message: 'Upload ticket expired. Retry to start a new upload.',
        retryable: true,
        code: 'UPLOAD_EXPIRED',
      };
    case 411:
    case 400:
      return {
        message: 'Upload request was rejected. Retry to start a new upload.',
        retryable: true,
        code: 'INVALID_REQUEST',
      };
    case 413:
      return {
        message: 'File exceeds 8 MB limit.',
        retryable: false,
        code: 'UPLOAD_TOO_LARGE',
      };
    case 429:
      return {
        message: 'Too many uploads in progress. Wait a moment and retry.',
        retryable: true,
        code: 'RATE_LIMITED',
      };
    case 408:
      return {
        message: 'Upload timed out. Retry when the connection is stable.',
        retryable: true,
        code: 'TIMEOUT',
      };
    default:
      return {
        message: 'Upload failed. Try again.',
        retryable: status >= 500,
        code: 'UNAVAILABLE',
      };
  }
}

export function mapActionErrorToUploadError(error: {
  code?: string;
  message?: string;
  retryable?: boolean;
}): UploadUserFacingError {
  const code = error.code ?? 'UNAVAILABLE';
  if (code === 'VERSION_CONFLICT') {
    return {
      message: 'A file with this name already exists.',
      retryable: false,
      code,
    };
  }
  if (code === 'DELIVERY_UNKNOWN') {
    return {
      message: 'Upload result is uncertain. Retry to confirm.',
      retryable: true,
      code,
    };
  }
  return {
    message: error.message || 'Upload commit failed. Try again.',
    retryable: Boolean(error.retryable),
    code,
  };
}

export function mapPrecheckRejectReason(reason: string): UploadUserFacingError {
  switch (reason) {
    case 'too_large':
      return { message: 'File exceeds 8 MB limit.', retryable: false, code: 'UPLOAD_TOO_LARGE' };
    case 'path_in_name':
    case 'empty_name':
    case 'unrepresentable_name':
      return {
        message: 'This file name cannot be used on the remote workspace.',
        retryable: false,
        code: 'UNREPRESENTABLE_NAME',
      };
    default:
      return { message: 'This file cannot be uploaded.', retryable: false, code: 'INVALID_REQUEST' };
  }
}
