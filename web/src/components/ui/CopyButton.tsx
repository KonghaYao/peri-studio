import { createSignal, onCleanup } from 'solid-js';
import { IconButton } from './Button';
import { CheckIcon, CopyIcon, ErrorIcon } from './Icon';

export function CopyButton(props: { text: string; label?: string; copiedLabel?: string; class?: string; size?: 'compact' | 'default'; disabled?: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { if (timer) clearTimeout(timer); });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      setFailed(false); setCopied(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); setFailed(true); }
  };
  const label = () => failed() ? 'Copy failed' : copied() ? (props.copiedLabel || 'Copied') : (props.label || 'Copy');
  return <IconButton type="button" size={props.size} class={props.class} onClick={copy} disabled={props.disabled} label={label()} aria-live="polite">
    {failed() ? <ErrorIcon /> : copied() ? <CheckIcon /> : <CopyIcon />}
  </IconButton>;
}
