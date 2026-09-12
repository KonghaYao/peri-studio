import { createSignal, Show, splitProps, type Component, type JSX } from 'solid-js';
import { safeRemoteImageSource } from '../../lib/markdown-safe';
import { Button } from '../Button';

export type SafeImageProps = JSX.ImgHTMLAttributes<HTMLImageElement> & {
  /** Catalog 可直出远程图；生产默认需用户确认。 */
  requireConsent?: boolean;
};

export const SafeImage: Component<SafeImageProps> = (props) => {
  const [local, rest] = splitProps(props, ['requireConsent', 'src', 'alt', 'class']);
  const source = () => safeRemoteImageSource(local.src);
  const hostname = () => {
    const value = source();
    return value ? new URL(value).hostname : '';
  };
  const [allowed, setAllowed] = createSignal(local.requireConsent === false);
  const alt = () => local.alt?.trim() || 'Remote image';

  return (
    <Show when={source()} fallback={<span class="text-12 text-content-muted">Image unavailable: {alt()}</span>}>
      {(src) => (
        <Show
          when={allowed()}
          fallback={(
            <span class="md-image-consent my-16 flex min-h-72 items-center justify-between gap-12 rounded-lg border border-border-subtle bg-surface-overlay px-14 py-12">
              <span class="min-w-0">
                <span class="block font-medium text-content-primary">{alt()}</span>
                <span class="block truncate text-12 text-content-muted">
                  {local.requireConsent === true ? `Remote image · ${hostname()}` : `Remote image blocked · ${hostname()}`}
                </span>
              </span>
              <Button size="compact" variant="default" onClick={() => setAllowed(true)}>
                {local.requireConsent === true ? 'Load image' : `Load image: ${alt()}`}
              </Button>
            </span>
          )}
        >
          <img
            {...rest}
            src={src()}
            alt={alt()}
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            class={local.class ?? 'md-image my-16 max-h-520 w-full rounded-lg border border-border-subtle bg-surface-overlay object-contain'}
          />
        </Show>
      )}
    </Show>
  );
};
