import { cva, type VariantProps } from 'class-variance-authority';
import {
  createContext,
  createSignal,
  For,
  Show,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';

type AvatarImageStatus = 'idle' | 'loaded' | 'error';

type AvatarContextValue = {
  imageStatus: () => AvatarImageStatus;
  setImageStatus: (status: AvatarImageStatus) => void;
};

const AvatarContext = createContext<AvatarContextValue>();

function useAvatarContext(): AvatarContextValue {
  const context = useContext(AvatarContext);
  if (!context) {
    throw new Error('Avatar compound components must be used within Avatar');
  }
  return context;
}

const avatarVariants = cva('relative flex shrink-0 overflow-hidden bg-surface-muted', {
  variants: {
    shape: {
      circle: 'rounded-full',
      square: 'rounded-8',
    },
    size: {
      xs: 'size-24 text-10',
      sm: 'size-28 text-11',
      md: 'size-36 text-12',
      lg: 'size-48 text-14',
      xl: 'size-64 text-16',
    },
  },
  defaultVariants: {
    shape: 'circle',
    size: 'md',
  },
});

type AvatarVariantProps = VariantProps<typeof avatarVariants>;

type AvatarProps = ComponentProps<'span'> & AvatarVariantProps;

export const Avatar: Component<AvatarProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'shape', 'size']);
  const [imageStatus, setImageStatus] = createSignal<AvatarImageStatus>('idle');
  return (
    <AvatarContext.Provider value={{ imageStatus, setImageStatus }}>
      <span
        data-slot="avatar"
        class={cn(avatarVariants({ shape: local.shape, size: local.size }), local.class)}
        {...rest}
      />
    </AvatarContext.Provider>
  );
};

export const AvatarImage: Component<ComponentProps<'img'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'onLoad', 'onError', 'src', 'alt']);
  const { setImageStatus } = useAvatarContext();

  return (
    <Show when={local.src}>
      <img
        data-slot="avatar-image"
        src={local.src}
        alt={local.alt ?? ''}
        class={cn('size-full object-cover', local.class)}
        onLoad={[() => setImageStatus('loaded'), local.onLoad]}
        onError={[() => setImageStatus('error'), local.onError]}
        {...rest}
      />
    </Show>
  );
};

export const AvatarFallback: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const { imageStatus } = useAvatarContext();

  return (
    <Show when={imageStatus() !== 'loaded'}>
      <span
        data-slot="avatar-fallback"
        class={cn(
          'flex size-full items-center justify-center bg-surface-muted font-medium text-text-secondary',
          local.class,
        )}
        {...rest}
      />
    </Show>
  );
};

export type AvatarGroupProps = ComponentProps<'div'> & {
  max?: number;
  size?: AvatarVariantProps['size'];
  shape?: AvatarVariantProps['shape'];
  /** 头像重叠间距（px），默认 -8 堆叠。 */
  gap?: number;
  children: JSX.Element;
};

/** 头像组：重叠堆叠，超出 max 时显示 +N。 */
export const AvatarGroup: Component<AvatarGroupProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'max', 'size', 'shape', 'gap', 'children']);
  const overlap = () => local.gap ?? -8;
  const childArray = () => (Array.isArray(local.children) ? local.children : [local.children]).filter(Boolean);
  const max = () => local.max ?? childArray().length;
  const visible = () => childArray().slice(0, max());
  const overflow = () => Math.max(0, childArray().length - max());

  return (
    <div data-slot="avatar-group" class={cn('flex items-center', local.class)} {...rest}>
      <For each={visible()}>
        {(child, index) => (
          <div
            class="relative"
            style={{ 'margin-left': index() === 0 ? '0' : `${overlap()}px`, 'z-index': String(visible().length - index()) }}
          >
            {child}
          </div>
        )}
      </For>
      <Show when={overflow() > 0}>
        <Avatar size={local.size} shape={local.shape} style={{ 'margin-left': `${overlap()}px` }}>
          <AvatarFallback>+{overflow()}</AvatarFallback>
        </Avatar>
      </Show>
    </div>
  );
};
