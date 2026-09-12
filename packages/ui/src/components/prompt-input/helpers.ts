import type { PromptInputError, PromptInputFilePart } from './types';

export function createPromptInputId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pi-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function convertBlobUrlToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** 屏幕截图：用户取消时返回 null，不抛错。 */
export async function captureScreenshot(): Promise<File | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    return null;
  }

  let stream: MediaStream | null = null;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
    video.srcObject = stream;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load screen stream'));
    });

    await video.play();

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) return null;

    const timestamp = new Date()
      .toISOString()
      .replaceAll(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '');

    return new File([blob], `screenshot-${timestamp}.png`, {
      lastModified: Date.now(),
      type: 'image/png',
    });
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    video.pause();
    video.srcObject = null;
  }
}

export function matchesAccept(file: File, accept?: string): boolean {
  if (!accept || accept.trim() === '') return true;

  const patterns = accept
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern.endsWith('/*')) {
      return file.type.startsWith(pattern.slice(0, -1));
    }
    return file.type === pattern;
  });
}

type ValidateFilesOptions = {
  accept?: string;
  maxFiles?: number;
  maxFileSize?: number;
  currentCount: number;
  onError?: (error: PromptInputError) => void;
};

export function validateIncomingFiles(
  fileList: File[] | FileList,
  options: ValidateFilesOptions,
): File[] {
  const incoming = [...fileList];
  if (incoming.length === 0) return [];

  const accepted = incoming.filter((file) => matchesAccept(file, options.accept));
  if (incoming.length > 0 && accepted.length === 0) {
    options.onError?.({
      code: 'accept',
      message: 'No files match the accepted types.',
    });
    return [];
  }

  const withinSize = (file: File) => (options.maxFileSize ? file.size <= options.maxFileSize : true);
  const sized = accepted.filter(withinSize);
  if (accepted.length > 0 && sized.length === 0) {
    options.onError?.({
      code: 'max_file_size',
      message: 'All files exceed the maximum size.',
    });
    return [];
  }

  const capacity =
    typeof options.maxFiles === 'number'
      ? Math.max(0, options.maxFiles - options.currentCount)
      : undefined;
  const capped = typeof capacity === 'number' ? sized.slice(0, capacity) : sized;

  if (typeof capacity === 'number' && sized.length > capacity) {
    options.onError?.({
      code: 'max_files',
      message: 'Too many files. Some were not added.',
    });
  }

  return capped;
}

export function filesToPromptInputParts(files: File[]): PromptInputFilePart[] {
  return files.map((file) => ({
    type: 'file',
    id: createPromptInputId(),
    filename: file.name,
    mediaType: file.type,
    url: URL.createObjectURL(file),
  }));
}

export function revokePromptInputFileUrls(files: PromptInputFilePart[]): void {
  for (const file of files) {
    if (file.url?.startsWith('blob:')) {
      URL.revokeObjectURL(file.url);
    }
  }
}
