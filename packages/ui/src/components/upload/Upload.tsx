import { For, Show, createSignal, splitProps, type Component, type JSX } from 'solid-js';
import { FileUp, RefreshCw, Trash2, UploadCloud } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { Button, IconButton } from '../Button';
import { Progress, ProgressFill, ProgressTrack } from '../Progress';

export type UploadFileStatus = 'uploading' | 'done' | 'error';

export type UploadFile = {
  uid: string;
  name: string;
  size?: number;
  status: UploadFileStatus;
  percent?: number;
  url?: string;
};

export type UploadListType = 'text' | 'picture' | 'picture-card';

export type UploadProps = {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  drag?: boolean;
  listType?: UploadListType;
  fileList?: UploadFile[];
  defaultFileList?: UploadFile[];
  onChange?: (files: UploadFile[]) => void;
  beforeUpload?: (file: File) => boolean | Promise<boolean>;
  customRequest?: (file: File, onProgress: (percent: number) => void) => Promise<void>;
  class?: string;
  children?: JSX.Element;
};

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uid() {
  return `upload-${Math.random().toString(36).slice(2, 10)}`;
}

/** 文件上传：拖拽区、列表类型、进度与失败重试。 */
export const Upload: Component<UploadProps> = (props) => {
  const [local] = splitProps(props, [
    'accept',
    'multiple',
    'disabled',
    'drag',
    'listType',
    'fileList',
    'defaultFileList',
    'onChange',
    'beforeUpload',
    'customRequest',
    'class',
    'children',
  ]);
  const [files, setFiles] = createSignal<UploadFile[]>(local.defaultFileList ?? []);
  const list = () => local.fileList ?? files();
  const setList = (next: UploadFile[]) => {
    if (local.fileList === undefined) setFiles(next);
    local.onChange?.(next);
  };

  const uploadOne = async (file: File) => {
    if (local.beforeUpload) {
      const allowed = await local.beforeUpload(file);
      if (!allowed) return;
    }
    const entry: UploadFile = {
      uid: uid(),
      name: file.name,
      size: file.size,
      status: 'uploading',
      percent: 0,
    };
    setList([...list(), entry]);
    const update = (patch: Partial<UploadFile>) => {
      setList(list().map((item) => (item.uid === entry.uid ? { ...item, ...patch } : item)));
    };
    try {
      if (local.customRequest) {
        await local.customRequest(file, (percent) => update({ percent }));
      } else {
        for (let percent = 10; percent <= 100; percent += 30) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          update({ percent });
        }
      }
      update({ status: 'done', percent: 100 });
    } catch {
      update({ status: 'error' });
    }
  };

  const onInputChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const selected = [...(input.files ?? [])];
    input.value = '';
    for (const file of selected) {
      await uploadOne(file);
    }
  };

  const retry = async (item: UploadFile) => {
    updateStatus(item.uid, { status: 'uploading', percent: 0 });
    try {
      for (let percent = 20; percent <= 100; percent += 40) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        updateStatus(item.uid, { percent });
      }
      updateStatus(item.uid, { status: 'done', percent: 100 });
    } catch {
      updateStatus(item.uid, { status: 'error' });
    }
  };

  const updateStatus = (id: string, patch: Partial<UploadFile>) => {
    setList(list().map((item) => (item.uid === id ? { ...item, ...patch } : item)));
  };

  const remove = (id: string) => setList(list().filter((item) => item.uid !== id));

  const listType = () => local.listType ?? 'text';
  const inputId = 'peri-upload-input';

  const trigger = (
    <label
      for={inputId}
      class={cn(
        'inline-flex cursor-pointer items-center gap-8 rounded-8 border border-dashed border-border-strong px-16 py-12 text-13 text-content-secondary transition-colors hover:border-accent-solid hover:text-accent-solid',
        local.disabled && 'cursor-not-allowed opacity-45',
        local.drag && 'flex min-h-120 w-full flex-col items-center justify-center gap-8',
      )}
    >
      <Show when={local.drag} fallback={<FileUp size={16} aria-hidden="true" />}>
        <UploadCloud size={28} class="text-content-muted" aria-hidden="true" />
        <span>Click or drag file to this area to upload</span>
      </Show>
      <Show when={!local.drag && local.children}>{local.children}</Show>
      <Show when={!local.drag && !local.children}>Upload</Show>
    </label>
  );

  return (
    <div data-slot="upload" data-list-type={listType()} class={cn('flex flex-col gap-10', local.class)}>
      <input
        id={inputId}
        type="file"
        class="sr-only"
        accept={local.accept}
        multiple={local.multiple}
        disabled={local.disabled}
        onChange={onInputChange}
      />
      {trigger}
      <Show when={list().length > 0}>
        <ul class="flex flex-col gap-8">
          <For each={list()}>
            {(item) => (
              <li class="flex items-center gap-10 rounded-8 border border-border-subtle px-12 py-8">
                <div class="min-w-0 flex-1">
                  <div class="truncate text-13 text-text-primary">{item.name}</div>
                  <div class="text-12 text-text-muted">{formatSize(item.size)}</div>
                  <Show when={item.status === 'uploading'}>
                    <Progress value={item.percent ?? 0} class="mt-6">
                      <ProgressTrack>
                        <ProgressFill />
                      </ProgressTrack>
                    </Progress>
                  </Show>
                  <Show when={item.status === 'error'}>
                    <div class="mt-4 text-12 text-danger">Upload failed</div>
                  </Show>
                </div>
                <Show when={item.status === 'error'}>
                  <IconButton label="Retry upload" size="sm" onClick={() => retry(item)}>
                    <RefreshCw size={14} />
                  </IconButton>
                </Show>
                <IconButton label="Remove file" size="sm" onClick={() => remove(item.uid)}>
                  <Trash2 size={14} />
                </IconButton>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

export const UploadButton: Component<{ onClick?: () => void; children?: JSX.Element }> = (props) => (
  <Button variant="default" size="sm" onClick={props.onClick}>{props.children ?? 'Select file'}</Button>
);
