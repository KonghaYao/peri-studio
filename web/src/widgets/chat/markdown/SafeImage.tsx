import { createSignal, Show, type JSX } from 'solid-js';
import { Button } from '../../../components/ui';
import { safeRemoteImageSource } from './source';

export function SafeImage(props: JSX.ImgHTMLAttributes<HTMLImageElement>) {
  const source = () => safeRemoteImageSource(props.src);
  const hostname = () => {
    const value = source();
    return value ? new URL(value).hostname : '';
  };
  const [allowed, setAllowed] = createSignal(false);
  const alt = () => props.alt?.trim() || 'Remote image';
  return <Show when={source()} fallback={<span class="text-text-tertiary">Image unavailable: {alt()}</span>}>
    {(src) => <Show when={allowed()} fallback={
      <span class="md-image-consent my-(--markdown-rich-block-gap) flex min-h-72 items-center justify-between gap-12 rounded-10 border border-border-subtle bg-surface px-14 py-12">
        <span class="min-w-0"><span class="block font-600 text-text-primary">{alt()}</span><span class="block truncate text-12 text-text-tertiary">Remote image blocked · {hostname()}</span></span>
        <Button size="compact" variant="secondary" onClick={() => setAllowed(true)} aria-label={`Load image: ${alt()}`}>Load image</Button>
      </span>
    }>
      <img {...props} src={src()} alt={alt()} loading="lazy" decoding="async" referrerpolicy="no-referrer" class="md-image my-(--markdown-rich-block-gap) max-h-520 rounded-10 border border-border-subtle object-contain" />
    </Show>}
  </Show>;
}
