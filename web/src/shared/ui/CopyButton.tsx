import { Check, Copy, X } from 'lucide-solid';
import { createSignal, onCleanup } from 'solid-js';
import { IconButton } from './Button';

type CopyButtonSize = 'sm' | 'md' | 'compact' | 'default';

function resolveSize(size: CopyButtonSize | undefined) {
  if (size === 'compact') return 'sm';
  if (size === 'default') return 'md';
  return size ?? 'sm';
}

export function CopyButton(props: {
  text: string;
  label?: string;
  copiedLabel?: string;
  class?: string;
  size?: CopyButtonSize;
  disabled?: boolean;
}) {
  const [copied, setCopied] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      setFailed(false);
      setCopied(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  };
  const label = () =>
    failed() ? 'Copy failed' : copied() ? props.copiedLabel || 'Copied' : props.label || 'Copy';
  return (
    <IconButton
      type="button"
      size={resolveSize(props.size)}
      class={props.class}
      onClick={copy}
      disabled={props.disabled}
      label={label()}
      aria-live="polite"
    >
      {failed() ? <X size={13} /> : copied() ? <Check size={13} /> : <Copy size={13} />}
    </IconButton>
  );
}
