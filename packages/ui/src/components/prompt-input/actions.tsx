import { Image, Monitor } from 'lucide-solid';
import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { captureScreenshot } from './helpers';
import { usePromptInputAttachments } from './context';
import { DropdownMenuItem } from '../dropdown-menu';

export type PromptInputActionAddAttachmentsProps = ComponentProps<typeof DropdownMenuItem> & {
  label?: string;
};

/** 操作菜单项：打开文件选择对话框。 */
export const PromptInputActionAddAttachments: Component<PromptInputActionAddAttachmentsProps> = (
  props,
) => {
  const [local, rest] = splitProps(props, ['label', 'onSelect']);
  const attachments = usePromptInputAttachments();

  const handleSelect = () => {
    attachments.openFileDialog();
  };

  return (
    <DropdownMenuItem {...rest} onSelect={handleSelect}>
      <Image size={16} strokeWidth={1.7} class="mr-8 shrink-0" aria-hidden="true" />
      {local.label ?? 'Add photos or files'}
    </DropdownMenuItem>
  );
};

export type PromptInputActionAddScreenshotProps = ComponentProps<typeof DropdownMenuItem> & {
  label?: string;
};

/** 操作菜单项：捕获屏幕截图并加入附件。 */
export const PromptInputActionAddScreenshot: Component<PromptInputActionAddScreenshotProps> = (
  props,
) => {
  const [local, rest] = splitProps(props, ['label', 'onSelect']);
  const attachments = usePromptInputAttachments();

  const handleSelect = async () => {
    try {
      const screenshot = await captureScreenshot();
      if (screenshot) attachments.add([screenshot]);
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'AbortError')
      ) {
        return;
      }
      throw error;
    }
  };

  return (
    <DropdownMenuItem {...rest} onSelect={handleSelect}>
      <Monitor size={16} strokeWidth={1.7} class="mr-8 shrink-0" aria-hidden="true" />
      {local.label ?? 'Take screenshot'}
    </DropdownMenuItem>
  );
};
