import { Paperclip, Plus } from 'lucide-solid';
import { Show, createSignal, type Component, type JSX } from 'solid-js';
import { Popover, PopoverContent, PopoverTrigger } from '../Popover';

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

function composerSurface(anchor?: HTMLElement | null) {
  return anchor?.closest<HTMLElement>('[data-slot="composer-surface"]')
    ?? anchor?.closest<HTMLElement>('.ui-composer-shell')
    ?? null;
}

/** T3：Composer「+」弹出层壳（上传入口 + slash 列表由 T4 注入）。
 *  锚在整条 composer surface 上，避免 288px 小浮层被 overflow 裁切、也铺不满输入条。 */
export const ComposerPlusMenu: Component<ComposerPlusMenuProps> = (props) => {
  let triggerEl: HTMLButtonElement | undefined;
  const [anchorWidth, setAnchorWidth] = createSignal<number | undefined>();

  const syncAnchorRect = (anchor?: HTMLElement) => {
    const surface = composerSurface(anchor ?? triggerEl);
    if (!surface) return undefined;
    const rect = surface.getBoundingClientRect();
    if (anchorWidth() !== rect.width) setAnchorWidth(rect.width);
    return rect;
  };

  return (
    <Popover
      open={props.open}
      onOpenChange={(open) => {
        if (open) syncAnchorRect();
        props.onOpenChange(open);
      }}
      placement="top"
      gutter={8}
      flip={false}
      fitViewport={false}
      getAnchorRect={(anchor) => syncAnchorRect(anchor)}
    >
      <PopoverTrigger
        ref={(element) => {
          triggerEl = element;
        }}
        class="ui-composer-plus-btn inline-flex shrink-0 items-center justify-center focus-visible:shadow-(--shadow-focus-ring) focus-visible:outline-none"
        aria-label="Slash commands"
        aria-expanded={props.open}
        disabled={props.disabled}
      >
        <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        class="ui-composer-slash-popover p-0 shadow-overlay"
        style={{
          '--composer-slash-width': anchorWidth() != null ? `${anchorWidth()}px` : undefined,
          width: anchorWidth() != null ? `${anchorWidth()}px` : undefined,
        }}
      >
        <Show when={props.upload}>
          {(upload) => (
            <button
              type="button"
              class="ui-composer-slash-upload"
              disabled={props.disabled || upload().disabled}
              onClick={() => {
                props.onOpenChange(false);
                upload().onClick();
              }}
            >
              <div class="grid min-w-0 grid-cols-slash-menu items-center gap-x-10">
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
};
