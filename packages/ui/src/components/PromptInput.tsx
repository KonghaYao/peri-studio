import {
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { createControllableSignal } from '../lib/controllable-state';
import {
  createReferencedSourcesContext,
  LocalAttachmentsContext,
  LocalReferencedSourcesContext,
  useOptionalPromptInputController,
  type PromptInputAttachmentsContext,
} from './prompt-input/context';
import { PromptInputFormContext } from './prompt-input/form-context';
import {
  convertBlobUrlToDataUrl,
  filesToPromptInputParts,
  revokePromptInputFileUrls,
  validateIncomingFiles,
} from './prompt-input/helpers';
import type {
  PromptInputError,
  PromptInputFilePart,
  PromptInputMessage,
  PromptInputSourceDocument,
} from './prompt-input/types';

export type { ChatStatus, PromptInputMessage, PromptInputSubmitData } from './prompt-input/types';
export {
  PromptInputProvider,
  usePromptInputAttachments,
  usePromptInputController,
  usePromptInputReferencedSources,
  useProviderAttachments,
} from './prompt-input/context';
export { usePromptInput } from './prompt-input/form-context';
export {
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
} from './prompt-input/actions';
export {
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandInput,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputCommandSeparator,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputHoverCard,
  PromptInputHoverCardContent,
  PromptInputHoverCardTrigger,
  PromptInputSubmit,
  PromptInputTab,
  PromptInputTabBody,
  PromptInputTabItem,
  PromptInputTabLabel,
  PromptInputTabsList,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputToolbar,
} from './prompt-input/parts';

type PromptInputProps = Omit<ComponentProps<'form'>, 'onSubmit'> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (message: PromptInputMessage) => void | Promise<void>;
  clearOnSubmit?: boolean;
  accept?: string;
  multiple?: boolean;
  globalDrop?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  onError?: (error: PromptInputError) => void;
};

/** Composer 根容器：管理文本、附件与表单提交。 */
export const PromptInput: Component<PromptInputProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'value',
    'defaultValue',
    'onValueChange',
    'onSubmit',
    'clearOnSubmit',
    'accept',
    'multiple',
    'globalDrop',
    'maxFiles',
    'maxFileSize',
    'onError',
  ]);

  const controller = useOptionalPromptInputController();
  const usingProvider = () => Boolean(controller);
  const clearOnSubmit = () => local.clearOnSubmit ?? true;

  const [localFiles, setLocalFiles] = createSignal<PromptInputFilePart[]>([]);
  const [referencedSources, setReferencedSources] = createSignal<PromptInputSourceDocument[]>([]);
  let fileInputNode: HTMLInputElement | undefined;
  let formNode: HTMLFormElement | undefined;

  const files = () => (usingProvider() ? controller!.attachments.files() : localFiles());

  const [text, setText] = createControllableSignal<string>({
    prop: () => (usingProvider() ? controller!.textInput.value() : local.value),
    defaultProp: local.defaultValue ?? '',
    onChange: (value) => {
      if (usingProvider()) controller!.textInput.setInput(value);
      local.onValueChange?.(value);
    },
  });

  const isEmpty = createMemo(() => text().trim().length === 0);

  const addValidated = (fileList: File[] | FileList) => {
    const capped = validateIncomingFiles(fileList, {
      accept: local.accept,
      maxFiles: local.maxFiles,
      maxFileSize: local.maxFileSize,
      currentCount: files().length,
      onError: local.onError,
    });
    if (capped.length === 0) return;

    if (usingProvider()) {
      controller!.attachments.add(capped);
      return;
    }

    setLocalFiles((prev) => [...prev, ...filesToPromptInputParts(capped)]);
  };

  const removeFile = (id: string) => {
    if (usingProvider()) {
      controller!.attachments.remove(id);
      return;
    }
    setLocalFiles((prev) => {
      const found = prev.find((file) => file.id === id);
      if (found?.url?.startsWith('blob:')) URL.revokeObjectURL(found.url);
      return prev.filter((file) => file.id !== id);
    });
  };

  const clearAttachments = () => {
    if (usingProvider()) {
      controller!.attachments.clear();
      return;
    }
    setLocalFiles((prev) => {
      revokePromptInputFileUrls(prev);
      return [];
    });
  };

  const clearAll = () => {
    clearAttachments();
    setReferencedSources([]);
  };

  const openFileDialog = () => {
    if (usingProvider()) {
      controller!.attachments.openFileDialog();
      return;
    }
    fileInputNode?.click();
  };

  const attachmentsCtx = createMemo<PromptInputAttachmentsContext>(() => ({
    files,
    add: addValidated,
    remove: removeFile,
    clear: clearAttachments,
    openFileDialog,
    fileInputRef: () => fileInputNode,
    setFileInputRef: (node) => {
      fileInputNode = node;
      if (usingProvider()) controller!.attachments.setFileInputRef(node);
    },
    registerOpenFileDialog: (open) => {
      if (usingProvider()) controller!.attachments.registerOpenFileDialog(open);
    },
  }));

  const refsCtx = createMemo(() =>
    createReferencedSourcesContext(referencedSources, setReferencedSources),
  );

  onCleanup(() => {
    if (!usingProvider()) revokePromptInputFileUrls(localFiles());
  });

  onMount(() => {
    attachmentsCtx().registerOpenFileDialog(() => fileInputNode?.click());
  });

  const handleFileInputChange: JSX.EventHandler<HTMLInputElement, Event> = (event) => {
    if (event.currentTarget.files) addValidated(event.currentTarget.files);
    event.currentTarget.value = '';
  };

  const setupDropTarget = (target: HTMLElement) => {
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
      if (event.dataTransfer?.files?.length) addValidated(event.dataTransfer.files);
    };
    target.addEventListener('dragover', onDragOver);
    target.addEventListener('drop', onDrop);
    onCleanup(() => {
      target.removeEventListener('dragover', onDragOver);
      target.removeEventListener('drop', onDrop);
    });
  };

  onMount(() => {
    if (local.globalDrop) {
      setupDropTarget(document.body);
      return;
    }
    if (formNode) setupDropTarget(formNode);
  });

  const submit = async () => {
    const trimmed = text().trim();
    if (!trimmed && files().length === 0) return;

    const convertedFiles = await Promise.all(
      files().map(async ({ id: _id, ...item }) => {
        if (item.url?.startsWith('blob:')) {
          const dataUrl = await convertBlobUrlToDataUrl(item.url);
          return { ...item, url: dataUrl ?? item.url };
        }
        return item;
      }),
    );

    try {
      const result = local.onSubmit?.({ text: trimmed, files: convertedFiles });
      if (result instanceof Promise) await result;
      if (clearOnSubmit()) {
        clearAll();
        if (usingProvider()) controller!.textInput.clear();
        else setText('');
      }
    } catch {
      // 提交失败时保留输入，便于重试
    }
  };

  const handleSubmit: JSX.EventHandlerUnion<HTMLFormElement, SubmitEvent> = (event) => {
    event.preventDefault();
    void submit();
  };

  const contextValue = {
    text,
    setText,
    isEmpty,
    submit: () => {
      void submit();
    },
  };

  return (
    <LocalAttachmentsContext.Provider value={attachmentsCtx()}>
      <LocalReferencedSourcesContext.Provider value={refsCtx()}>
        <input
          accept={local.accept}
          aria-label="Upload files"
          class="hidden"
          multiple={local.multiple}
          onChange={handleFileInputChange}
          ref={(node) => attachmentsCtx().setFileInputRef(node)}
          title="Upload files"
          type="file"
        />
        <PromptInputFormContext.Provider value={contextValue}>
          <form
            data-slot="prompt-input"
            class={cn(
              'flex w-full flex-col overflow-hidden rounded-8 border border-border-strong bg-surface shadow-(--shadow-composer-overlay) ui-control-transition',
              'focus-within:border-focus-ring',
              local.class,
            )}
            onSubmit={handleSubmit}
            ref={(node) => {
              formNode = node;
            }}
            {...rest}
          >
            {local.children}
          </form>
        </PromptInputFormContext.Provider>
      </LocalReferencedSourcesContext.Provider>
    </LocalAttachmentsContext.Provider>
  );
};
