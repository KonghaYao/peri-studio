import { cn } from '@/lib/cn';

export function Spinner(props: { class?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={props.label ?? 'Loading'}
      class={cn(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent',
        props.class,
      )}
    />
  );
}
