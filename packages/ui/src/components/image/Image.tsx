import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-solid';
import {
  createSignal,
  For,
  Show,
  splitProps,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import { Dialog, DialogContent, DialogOverlay, DialogPortal } from '../Dialog';

export type ImageProps = ComponentProps<'img'> & {
  preview?: boolean;
  fallback?: JSX.Element;
  previewSrc?: string;
};

/** 可预览图片：点击放大、缩放与多图切换由 PreviewGroup 提供。 */
export const Image: Component<ImageProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'src', 'alt', 'preview', 'fallback', 'previewSrc', 'onClick']);
  const [open, setOpen] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const previewable = () => local.preview !== false && !!local.src;

  return (
    <>
      <Show
        when={!failed()}
        fallback={local.fallback ?? <span class="text-12 text-content-muted">Image failed to load</span>}
      >
        <img
          data-slot="image"
          src={local.src}
          alt={local.alt ?? ''}
          class={cn(
            'max-w-full rounded-8 border border-border-subtle bg-surface-overlay object-contain',
            previewable() ? 'cursor-zoom-in' : '',
            local.class,
          )}
          onError={() => setFailed(true)}
          onClick={(event) => {
            if (typeof local.onClick === 'function') local.onClick(event);
            if (previewable()) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          {...rest}
        />
      </Show>
      <Show when={previewable()}>
        <ImagePreview
          open={open()}
          onOpenChange={setOpen}
          src={local.previewSrc ?? local.src ?? ''}
          alt={local.alt}
        />
      </Show>
    </>
  );
};

export type ImagePreviewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt?: string;
  images?: string[];
  current?: number;
  onCurrentChange?: (index: number) => void;
};

export const ImagePreview: Component<ImagePreviewProps> = (props) => {
  const [scale, setScale] = createSignal(1);
  const index = () => props.current ?? 0;
  const sources = () => props.images ?? [props.src];
  const currentSrc = () => sources()[index()] ?? props.src;

  const prev = () => {
    const next = Math.max(0, index() - 1);
    props.onCurrentChange?.(next);
  };
  const next = () => {
    const nextIndex = Math.min(sources().length - 1, index() + 1);
    props.onCurrentChange?.(nextIndex);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogOverlay class="bg-scrim/90" />
        <DialogContent class="fixed inset-0 z-70 flex flex-col bg-transparent shadow-none">
          <div class="flex items-center justify-end gap-8 p-12">
            <IconButton label="Zoom out" size="sm" onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}>
              <ZoomOut size={16} />
            </IconButton>
            <IconButton label="Zoom in" size="sm" onClick={() => setScale((s) => Math.min(3, s + 0.25))}>
              <ZoomIn size={16} />
            </IconButton>
            <IconButton label="Close preview" size="sm" onClick={() => props.onOpenChange(false)}>
              <X size={16} />
            </IconButton>
          </div>
          <div class="relative flex flex-1 items-center justify-center overflow-hidden px-48">
            <Show when={sources().length > 1}>
              <IconButton
                label="Previous image"
                size="sm"
                class="absolute left-12"
                disabled={index() <= 0}
                onClick={prev}
              >
                <ChevronLeft size={18} />
              </IconButton>
            </Show>
            <img
              src={currentSrc()}
              alt={props.alt ?? ''}
              class="max-h-full max-w-full object-contain transition-transform duration-120"
              style={{ transform: `scale(${scale()})` }}
            />
            <Show when={sources().length > 1}>
              <IconButton
                label="Next image"
                size="sm"
                class="absolute right-12"
                disabled={index() >= sources().length - 1}
                onClick={next}
              >
                <ChevronRight size={18} />
              </IconButton>
            </Show>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};

export type ImagePreviewGroupProps = {
  class?: string;
  images: string[];
  preview?: boolean;
};

/** 多图预览组：共享画廊导航。 */
export function ImagePreviewGroup(props: ImagePreviewGroupProps) {
  const [open, setOpen] = createSignal(false);
  const [current, setCurrent] = createSignal(0);

  return (
    <div data-slot="image-preview-group" class={cn('flex flex-wrap gap-8', props.class)}>
      <For each={props.images}>
        {(src, index) => (
          <img
            data-slot="image"
            src={src}
            alt=""
            class="size-96 cursor-zoom-in rounded-8 border border-border-subtle object-cover"
            onClick={() => {
              setCurrent(index());
              setOpen(true);
            }}
          />
        )}
      </For>
      <Show when={props.preview !== false}>
        <ImagePreview
          open={open()}
          onOpenChange={setOpen}
          src={props.images[current()] ?? ''}
          images={props.images}
          current={current()}
          onCurrentChange={setCurrent}
        />
      </Show>
    </div>
  );
}
