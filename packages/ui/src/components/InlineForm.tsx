import {
  createContext,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { resolveLayoutGap, type LayoutGapSize } from '../lib/layout-gap';
import { mergeInlineStyle } from '../lib/merge-style';

type InlineFormAlign = 'start' | 'end' | 'center' | 'stretch';

type InlineFormContextValue = {
  gap: LayoutGapSize;
};

const InlineFormContext = createContext<InlineFormContextValue>({ gap: 'small' });

export type InlineFormProps = Omit<ComponentProps<'form'>, 'onSubmit'> & {
  /** Fixed column count. Omit to use auto-fill with `minTrack`. */
  columns?: number;
  /** Min track width in px when `columns` is omitted. Default 144. */
  minTrack?: number;
  gap?: LayoutGapSize;
  /** Cross-axis alignment of grid items. Default `end` for control baselines. */
  align?: InlineFormAlign;
  onSubmit?: (event: SubmitEvent) => void;
};

const ALIGN_CLASS: Record<InlineFormAlign, string> = {
  start: 'items-start',
  end: 'items-end',
  center: 'items-center',
  stretch: 'items-stretch',
};

function resolveGridTemplate(columns?: number, minTrack?: number): string {
  if (columns !== undefined && columns > 0) {
    return `repeat(${columns}, minmax(0, 1fr))`;
  }
  const track = minTrack ?? 144;
  return `repeat(auto-fill, minmax(${track}px, 1fr))`;
}

function InlineFormRoot(props: InlineFormProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'columns',
    'minTrack',
    'gap',
    'align',
    'onSubmit',
    'style',
  ]);

  const gap = () => local.gap ?? 'small';
  const align = () => local.align ?? 'end';

  const formStyle = (): JSX.CSSProperties | undefined => {
    const patch: JSX.CSSProperties = {
      'grid-template-columns': resolveGridTemplate(local.columns, local.minTrack),
      gap: resolveLayoutGap(gap()),
    };
    return mergeInlineStyle(local.style, patch);
  };

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    local.onSubmit?.(event);
  };

  return (
    <InlineFormContext.Provider value={{ gap: gap() }}>
      <form
        data-slot="inline-form"
        class={cn('ui-inline-form grid w-full min-w-0', ALIGN_CLASS[align()], local.class)}
        style={formStyle()}
        onSubmit={handleSubmit}
        {...rest}
      >
        {local.children}
      </form>
    </InlineFormContext.Provider>
  );
}

export type InlineFormFieldProps = ComponentProps<'div'> & {
  /** Number of grid tracks to span. Default 1. */
  span?: number;
};

const InlineFormField: Component<InlineFormFieldProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'span', 'style']);
  const span = () => Math.max(1, local.span ?? 1);

  const fieldStyle = (): JSX.CSSProperties | undefined => {
    if (span() <= 1) return local.style as JSX.CSSProperties | undefined;
    return mergeInlineStyle(local.style, { 'grid-column': `span ${span()}` });
  };

  return (
    <div
      data-slot="inline-form-field"
      class={cn('ui-inline-form-field min-w-0', local.class)}
      style={fieldStyle()}
      {...rest}
    >
      {local.children}
    </div>
  );
};

export type InlineFormActionsProps = ComponentProps<'div'> & {
  /** Horizontal alignment inside the actions cluster. Default `end`. */
  align?: 'start' | 'end' | 'center';
  /**
   * When true, actions span the full grid width on their row and align to the end.
   * When false (default), actions occupy grid cells inline with fields.
   */
  trailing?: boolean;
  /** Grid tracks to span when `trailing` is false. Default 2. */
  span?: number;
};

const InlineFormActions: Component<InlineFormActionsProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'align', 'trailing', 'span', 'style']);
  const ctx = useContext(InlineFormContext);
  const align = () => local.align ?? 'end';
  const trailing = () => local.trailing ?? false;
  const span = () => Math.max(1, local.span ?? 2);

  const actionsStyle = (): JSX.CSSProperties | undefined => {
    const patch: JSX.CSSProperties = {
      gap: resolveLayoutGap(ctx.gap),
    };
    if (trailing()) {
      patch['grid-column'] = '1 / -1';
    } else if (span() > 1) {
      patch['grid-column'] = `span ${span()}`;
      patch['justify-self'] =
        align() === 'start' ? 'start' : align() === 'center' ? 'center' : 'end';
    } else {
      patch['justify-self'] =
        align() === 'start' ? 'start' : align() === 'center' ? 'center' : 'end';
    }
    return mergeInlineStyle(local.style, patch);
  };

  return (
    <div
      data-slot="inline-form-actions"
      class={cn(
        'ui-inline-form-actions flex shrink-0 flex-wrap items-center',
        align() === 'start'
          ? 'justify-start'
          : align() === 'center'
            ? 'justify-center'
            : 'justify-end',
        local.class,
      )}
      style={actionsStyle()}
      {...rest}
    >
      {local.children}
    </div>
  );
};

/** T3 · 内联筛选/工具栏表单：CSS Grid 轨道 + Field span + 尾部 Actions 簇。 */
export const InlineForm = Object.assign(InlineFormRoot, {
  Field: InlineFormField,
  Actions: InlineFormActions,
});
