import { Paperclip, Plus } from 'lucide-solid';
import { Show, type Component, type JSX } from 'solid-js';
import { Popover, PopoverContent, PopoverTrigger } from '../Popover';
import { composerPlusBtnClass, composerSlashPopoverClass, composerSlashUploadClass } from './composer-layout';

export type ComposerPlusMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  upload?: {
    disabled?: boolean;
    onClick: () => void;
  };
  slashMenu: JSX.Element;
};

/** T3：Composer「+」弹出层壳。锚在加号按钮上，宽度走菜单 token，不铺满整条输入条。 */
export const ComposerPlusMenu: Component<ComposerPlusMenuProps> = (props) => (
  <Popover
    open={props.open}
    onOpenChange={props.onOpenChange}
    placement="top-start"
    gutter={8}
    flip={false}
    fitViewport={false}
  >
    <PopoverTrigger
      class={composerPlusBtnClass}
      aria-label="Slash commands"
      aria-expanded={props.open}
      disabled={props.disabled}
    >
      <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
    </PopoverTrigger>
    <PopoverContent class={composerSlashPopoverClass}>
      <Show when={props.upload}>
        {(upload) => (
          <button
            type="button"
            class={composerSlashUploadClass}
            disabled={props.disabled || upload().disabled}
            onClick={() => {
              props.onOpenChange(false);
              upload().onClick();
            }}
          >
            <div class="grid w-full min-w-0 grid-cols-slash-menu items-center gap-x-10">
              <span class="grid size-16 shrink-0 place-items-center">
                <Paperclip size={14} strokeWidth={1.7} class="text-content-muted" aria-hidden="true" />
              </span>
              <span class="min-w-0 truncate text-13 font-medium text-content-primary">Upload files</span>
              <span class="min-w-0 truncate text-12 text-content-muted">
                Attach images, docs, or code
              </span>
            </div>
          </button>
        )}
      </Show>
      {props.slashMenu}
    </PopoverContent>
  </Popover>
);
