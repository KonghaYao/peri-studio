import { createSignal, Show, type JSX } from 'solid-js';
import { Button } from '@/lib/catalog-ui';
import { safeRemoteImageSource } from './safe';

/** 沙箱默认直出远程图；生产可设 requireConsent。 */
export function SafeImage(props: JSX.ImgHTMLAttributes<HTMLImageElement> & { requireConsent?: boolean }) {
  const source = () => safeRemoteImageSource(props.src);
  const hostname = () => {
    const value = source();
    return value ? new URL(value).hostname : '';
  };
  const [allowed, setAllowed] = createSignal(!props.requireConsent);
  const alt = () => props.alt?.trim() || 'Remote image';
  return (
    <Show when={source()} fallback={<span class="text-12 text-content-muted">Image unavailable: {alt()}</span>}>
      {(src) => (
        <Show
          when={allowed()}
          fallback={
            <span class="my-4 flex min-h-18 items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-overlay px-3.5 py-3">
              <span class="min-w-0">
                <span class="block font-medium text-content-primary">{alt()}</span>
                <span class="block truncate text-12 text-content-muted">Remote image · {hostname()}</span>
              </span>
              <Button size="sm" variant="default" onClick={() => setAllowed(true)}>Load image</Button>
            </span>
          }
        >
          <img
            {...props}
            src={src()}
            alt={alt()}
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            class="my-4 max-h-80 w-full rounded-lg border border-border-subtle bg-surface-overlay object-contain"
          />
        </Show>
      )}
    </Show>
  );
}
