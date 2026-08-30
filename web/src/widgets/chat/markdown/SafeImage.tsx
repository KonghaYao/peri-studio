import { createSignal, Show, type JSX } from 'solid-js';
import { Button } from '@/shared/ui';
import { safeRemoteImageSource } from './source';

export function SafeImage(props: JSX.ImgHTMLAttributes<HTMLImageElement>) {
  const source = () => safeRemoteImageSource(props.src);
  const hostname = () => {
    const value = source();
    return value ? new URL(value).hostname : '';
  };
  const [allowed, setAllowed] = createSignal(false);
  const alt = () => props.alt?.trim() || 'Remote image';
  return <Show when={source()} fallback={<span class="text-12 text-content-muted">Image unavailable: {alt()}</span>}>
    {(src) => <Show when={allowed()} fallback={
      <span class="md-image-consent my-16 flex min-h-72 items-center justify-between gap-12 rounded-lg border border-border-subtle bg-surface-overlay px-14 py-12">
        <span class="min-w-0"><span class="block font-medium text-content-primary">{alt()}</span><span class="block truncate text-12 text-content-muted">Remote image blocked · {hostname()}</span></span>
        <Button size="compact" variant="default" onClick={() => setAllowed(true)}>Load image: {alt()}</Button>
      </span>
    }>
      <img {...props} src={src()} alt={alt()} loading="lazy" decoding="async" referrerpolicy="no-referrer" class="md-image my-16 max-h-520 w-full rounded-lg border border-border-subtle bg-surface-overlay object-contain" />
    </Show>}
  </Show>;
}
