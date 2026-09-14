import { Check, ChevronRight, Copy, X } from 'lucide-solid';
import { Show, createSignal, onCleanup, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { IconButton } from './Button';
import {
  copyPayloadForRow,
  type JsonTreeRow,
  valuePreview,
  valueToneClass,
} from './json-tree-model';

type JsonTreeRowProps = {
  row: JsonTreeRow;
  onToggle: (path: string) => void;
};

function JsonTreeRowCopy(props: { path: string; value: unknown; expandable: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const label = () => {
    if (failed()) return 'Copy failed';
    if (copied()) return 'Copied';
    return props.expandable ? 'Copy path' : 'Copy';
  };

  const copy = async () => {
    const text = copyPayloadForRow(props.path, props.value, props.expandable);
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  };

  return (
    <IconButton
      type="button"
      label={label()}
      title={label()}
      size="sm"
      variant="ghost"
      showTooltip={false}
      class="h-20 w-20 shrink-0 border-0 bg-transparent p-0 text-content-muted hover:text-content-primary"
      onClick={copy}
      aria-live="polite"
    >
      {failed() ? <X size={12} aria-hidden="true" /> : copied() ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </IconButton>
  );
}

/** 单行 JSON 树节点（扁平/虚拟列表共用）。 */
export const JsonTreeRowView: Component<JsonTreeRowProps> = (props) => {
  const row = () => props.row;
  const indent = () => row().depth * 12;

  return (
    <div
      class="group font-mono text-11 leading-16"
      data-json-path={row().path}
      style={{ 'padding-left': `${indent()}px` }}
    >
      <div class="flex min-w-0 items-start gap-4 py-2">
        <Show
          when={row().expandable}
          fallback={<span class="inline-block w-20 shrink-0" aria-hidden="true" />}
        >
          <IconButton
            label={row().expanded ? 'Collapse' : 'Expand'}
            size="compact"
            variant="ghost"
            showTooltip={false}
            class="mt-1 h-16 w-16 shrink-0 border-0 bg-transparent p-0 text-content-muted hover:text-content-primary"
            onClick={() => props.onToggle(row().path)}
          >
            <ChevronRight
              size={12}
              class={cn('transition-transform', row().expanded && 'rotate-90')}
              aria-hidden="true"
            />
          </IconButton>
        </Show>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 flex-wrap items-baseline gap-6">
            <Show when={row().name}>
              <span class="text-accent-solid">{row().name}</span>
              <span class="text-content-muted">:</span>
            </Show>
            <Show
              when={row().expandable && !row().expanded}
              fallback={(
                <span class={cn(valueToneClass(row().value))}>
                  {valuePreview(row().value)}
                </span>
              )}
            >
              <span class="text-content-muted">{valuePreview(row().value)}</span>
            </Show>
          </div>
        </div>
        <div class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <JsonTreeRowCopy
            path={row().path}
            value={row().value}
            expandable={row().expandable}
          />
        </div>
      </div>
    </div>
  );
};
