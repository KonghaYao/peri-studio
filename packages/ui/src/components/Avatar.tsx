import {
  createContext,
  createSignal,
  Show,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
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

export const Avatar: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const [imageStatus, setImageStatus] = createSignal<AvatarImageStatus>('idle');
  return (
    <AvatarContext.Provider value={{ imageStatus, setImageStatus }}>
      <span
        data-slot="avatar"
        class={cn(
          'relative flex size-32 shrink-0 overflow-hidden rounded-full bg-surface-muted',
          local.class,
        )}
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
          'flex size-full items-center justify-center bg-surface-muted text-12 font-medium text-text-secondary',
          local.class,
        )}
        {...rest}
      />
    </Show>
  );
};
