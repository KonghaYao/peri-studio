/** AI SDK ChatStatus 对齐：控制提交按钮图标与 stop 行为。 */
export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type PromptInputFilePart = {
  type: 'file';
  id: string;
  filename?: string;
  mediaType?: string;
  url?: string;
};

export type PromptInputSourceDocument = {
  type: 'source-document';
  id: string;
  title?: string;
  filename?: string;
  mediaType?: string;
};

export type PromptInputSubmitFilePart = {
  type: 'file';
  filename?: string;
  mediaType?: string;
  url?: string;
};

export type PromptInputMessage = {
  text: string;
  files: PromptInputSubmitFilePart[];
};

/** @deprecated 使用 PromptInputMessage；保留别名以兼容既有调用方。 */
export type PromptInputSubmitData = PromptInputMessage;

export type PromptInputErrorCode = 'max_files' | 'max_file_size' | 'accept';

export type PromptInputError = {
  code: PromptInputErrorCode;
  message: string;
};
