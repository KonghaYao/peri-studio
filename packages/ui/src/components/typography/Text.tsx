import { Check, Copy, Pencil } from 'lucide-solid';
import {
  createSignal,
  onCleanup,
  Show,
  splitProps,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';

export type TypographyTextOptions = {
  ellipsis?: boolean | { rows?: number };
  copyable?: boolean | { text?: string };
  editable?: boolean | { onChange?: (value: string) => void };
};

function ellipsisClass(ellipsis?: boolean | { rows?: number }) {
  if (!ellipsis) return '';
  if (typeof ellipsis === 'object' && ellipsis.rows && ellipsis.rows > 1) {
    return 'ui-typography-ellipsis-multiline';
  }
  return 'truncate';
}

function EllipsisStyle(props: { rows?: number }) {
  if (!props.rows || props.rows <= 1) return null;
  return (
    <style>
      {`.ui-typography-ellipsis-multiline{display:-webkit-box;-webkit-line-clamp:${props.rows};-webkit-box-orient:vertical;overflow:hidden;}`}
    </style>
  );
}

function useCopy(text: () => string) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });
  const copy = async () => {
    await navigator.clipboard.writeText(text());
    setCopied(true);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), 1600);
  };
  return { copied, copy };
}

type TypographyTextProps = ComponentProps<'span'> & TypographyTextOptions;

export const TypographyText: Component<TypographyTextProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'ellipsis', 'copyable', 'editable']);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const copyText = () => {
    if (typeof local.copyable === 'object' && local.copyable.text) return local.copyable.text;
    return String(local.children ?? '');
  };
  const { copied, copy } = useCopy(copyText);
  const rows = () => (typeof local.ellipsis === 'object' ? local.ellipsis.rows : undefined);

  const startEdit = () => {
    setDraft(copyText());
    setEditing(true);
  };
  const commitEdit = () => {
    if (typeof local.editable === 'object') local.editable.onChange?.(draft());
    setEditing(false);
  };

  return (
    <span data-slot="typography-text" class={cn('inline-flex max-w-full items-start gap-6', local.class)}>
      <EllipsisStyle rows={rows()} />
      <Show
        when={editing()}
        fallback={(
          <span class={cn('min-w-0 text-13 text-content-primary', ellipsisClass(local.ellipsis))} {...rest}>
            {local.children}
          </span>
        )}
      >
        <input
          class="min-w-0 flex-1 rounded-4 border border-border-strong bg-surface px-8 py-4 text-13"
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onBlur={commitEdit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitEdit();
            if (event.key === 'Escape') setEditing(false);
          }}
        />
      </Show>
      <Show when={local.copyable}>
        <IconButton label={copied() ? 'Copied' : 'Copy'} size="sm" onClick={copy}>
          {copied() ? <Check size={12} /> : <Copy size={12} />}
        </IconButton>
      </Show>
      <Show when={local.editable}>
        <IconButton label="Edit" size="sm" onClick={startEdit}>
          <Pencil size={12} />
        </IconButton>
      </Show>
    </span>
  );
};

type TitleProps = ComponentProps<'div'> &
  TypographyTextOptions & {
    level?: 1 | 2 | 3 | 4 | 5;
  };

export const TypographyTitle: Component<TitleProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'level', 'ellipsis', 'copyable', 'editable', 'children']);
  const level = () => local.level ?? 1;
  const sizeClass = () => {
    if (level() === 1) return 'text-28 font-bold';
    if (level() === 2) return 'text-24 font-semibold';
    if (level() === 3) return 'text-18 font-semibold';
    if (level() === 4) return 'text-16 font-semibold';
    return 'text-14 font-semibold';
  };
  return (
    <div
      data-slot="typography-title"
      role="heading"
      aria-level={level()}
      class={cn(sizeClass(), 'text-content-primary', local.class)}
      {...rest}
    >
      <TypographyText ellipsis={local.ellipsis} copyable={local.copyable} editable={local.editable}>
        {local.children}
      </TypographyText>
    </div>
  );
};

export const TypographyParagraph: Component<ComponentProps<'p'> & TypographyTextOptions> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'ellipsis', 'copyable', 'editable', 'children']);
  return (
    <p data-slot="typography-paragraph" class={cn('text-13 leading-20 text-content-primary', local.class)} {...rest}>
      <TypographyText ellipsis={local.ellipsis} copyable={local.copyable} editable={local.editable}>
        {local.children}
      </TypographyText>
    </p>
  );
};
