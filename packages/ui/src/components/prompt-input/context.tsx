import {
  createContext,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import {
  createPromptInputId,
  filesToPromptInputParts,
  revokePromptInputFileUrls,
} from './helpers';
import type { PromptInputFilePart, PromptInputSourceDocument } from './types';

export interface PromptInputAttachmentsContext {
  files: Accessor<PromptInputFilePart[]>;
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: () => HTMLInputElement | undefined;
  setFileInputRef: (node: HTMLInputElement | undefined) => void;
  registerOpenFileDialog: (open: () => void) => void;
}

export interface PromptInputTextContext {
  value: Accessor<string>;
  setInput: (value: string) => void;
  clear: () => void;
}

export interface PromptInputControllerContext {
  textInput: PromptInputTextContext;
  attachments: PromptInputAttachmentsContext;
}

export interface PromptInputReferencedSourcesContext {
  sources: Accessor<PromptInputSourceDocument[]>;
  add: (sources: PromptInputSourceDocument[] | PromptInputSourceDocument) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const PromptInputControllerContext = createContext<PromptInputControllerContext>();
const ProviderAttachmentsContext = createContext<PromptInputAttachmentsContext>();
const LocalAttachmentsContext = createContext<PromptInputAttachmentsContext>();
const LocalReferencedSourcesContext = createContext<PromptInputReferencedSourcesContext>();

export function usePromptInputController(): PromptInputControllerContext {
  const context = useContext(PromptInputControllerContext);
  if (!context) {
    throw new Error(
      'Wrap your component inside <PromptInputProvider> to use usePromptInputController().',
    );
  }
  return context;
}

export function useOptionalPromptInputController() {
  return useContext(PromptInputControllerContext);
}

export function useProviderAttachments(): PromptInputAttachmentsContext {
  const context = useContext(ProviderAttachmentsContext);
  if (!context) {
    throw new Error(
      'Wrap your component inside <PromptInputProvider> to use useProviderAttachments().',
    );
  }
  return context;
}

export function useOptionalProviderAttachments() {
  return useContext(ProviderAttachmentsContext);
}

export function usePromptInputAttachments(): PromptInputAttachmentsContext {
  const provider = useOptionalProviderAttachments();
  const local = useContext(LocalAttachmentsContext);
  const context = local ?? provider;
  if (!context) {
    throw new Error(
      'usePromptInputAttachments must be used within a PromptInput or PromptInputProvider',
    );
  }
  return context;
}

export function usePromptInputReferencedSources(): PromptInputReferencedSourcesContext {
  const context = useContext(LocalReferencedSourcesContext);
  if (!context) {
    throw new Error(
      'usePromptInputReferencedSources must be used within a PromptInput tree',
    );
  }
  return context;
}

export type PromptInputProviderProps = {
  initialInput?: string;
  children?: JSX.Element;
};

/** 可选全局 Provider：将文本与附件状态提升到 PromptInput 外部。 */
export const PromptInputProvider: Component<PromptInputProviderProps> = (props) => {
  const [textInput, setTextInput] = createSignal(props.initialInput ?? '');
  const [attachmentFiles, setAttachmentFiles] = createSignal<PromptInputFilePart[]>([]);
  let fileInputNode: HTMLInputElement | undefined;
  let openFileDialogImpl: () => void = () => undefined;

  const add = (files: File[] | FileList) => {
    const incoming = [...files];
    if (incoming.length === 0) return;
    setAttachmentFiles((prev) => [...prev, ...filesToPromptInputParts(incoming)]);
  };

  const remove = (id: string) => {
    setAttachmentFiles((prev) => {
      const found = prev.find((file) => file.id === id);
      if (found?.url?.startsWith('blob:')) URL.revokeObjectURL(found.url);
      return prev.filter((file) => file.id !== id);
    });
  };

  const clear = () => {
    setAttachmentFiles((prev) => {
      revokePromptInputFileUrls(prev);
      return [];
    });
  };

  onCleanup(() => {
    revokePromptInputFileUrls(attachmentFiles());
  });

  const attachments: PromptInputAttachmentsContext = {
    files: attachmentFiles,
    add,
    remove,
    clear,
    openFileDialog: () => openFileDialogImpl(),
    fileInputRef: () => fileInputNode,
    setFileInputRef: (node) => {
      fileInputNode = node;
    },
    registerOpenFileDialog: (open) => {
      openFileDialogImpl = open;
    },
  };

  const controller: PromptInputControllerContext = {
    textInput: {
      value: textInput,
      setInput: setTextInput,
      clear: () => setTextInput(''),
    },
    attachments,
  };

  return (
    <PromptInputControllerContext.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>
        {props.children}
      </ProviderAttachmentsContext.Provider>
    </PromptInputControllerContext.Provider>
  );
};

export function createReferencedSourcesContext(
  sources: Accessor<PromptInputSourceDocument[]>,
  setSources: (
    updater: (prev: PromptInputSourceDocument[]) => PromptInputSourceDocument[],
  ) => void,
): PromptInputReferencedSourcesContext {
  return {
    sources,
    add: (incoming) => {
      const array = Array.isArray(incoming) ? incoming : [incoming];
      setSources((prev) => [
        ...prev,
        ...array.map((source) => ({ ...source, id: source.id || createPromptInputId() })),
      ]);
    },
    remove: (id) => {
      setSources((prev) => prev.filter((source) => source.id !== id));
    },
    clear: () => setSources(() => []),
  };
}

export {
  LocalAttachmentsContext,
  LocalReferencedSourcesContext,
};
