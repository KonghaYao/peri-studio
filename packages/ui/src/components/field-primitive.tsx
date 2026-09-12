import { cva, type VariantProps } from 'class-variance-authority';
import {
  createMemo,
  Show,
  splitProps,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Label } from './Label';
import { Separator } from './Separator';

/** 语义 fieldset 分组容器。 */
export const FieldSet: Component<ComponentProps<'fieldset'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <fieldset
      data-slot="field-set"
      class={cn(
        'm-0 flex min-w-0 flex-col gap-16 border-0 p-0',
        'has-[>[data-slot=checkbox-group]]:gap-12 has-[>[data-slot=radio-group]]:gap-12',
        local.class,
      )}
      {...rest}
    />
  );
};

type FieldLegendProps = ComponentProps<'legend'> & {
  variant?: 'legend' | 'label';
};

/** fieldset 标题；`label` 变体对齐 Label 字号。 */
export const FieldLegend: Component<FieldLegendProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'variant']);
  const variant = () => local.variant ?? 'legend';
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant()}
      class={cn(
        'mb-6 font-medium',
        'data-[variant=label]:text-12 data-[variant=legend]:text-14',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 相关字段的纵向堆叠容器；支持 `@container/field-group` 响应式方向。 */
export const FieldGroup: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="field-group"
      class={cn(
        'group/field-group @container/field-group flex w-full flex-col gap-20',
        'data-[slot=checkbox-group]:gap-12 *:data-[slot=field-group]:gap-16',
        local.class,
      )}
      {...rest}
    />
  );
};

const fieldVariants = cva(
  'group/field flex w-full gap-8 data-[invalid=true]:text-danger',
  {
    variants: {
      orientation: {
        vertical: 'flex-col *:w-full [&>.sr-only]:w-auto',
        horizontal: [
          'flex-row items-center',
          '*:data-[slot=field-label]:flex-auto',
          'has-[>[data-slot=field-content]]:items-start has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
        ],
        responsive: [
          'flex-col *:w-full [&>.sr-only]:w-auto',
          '@md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto',
          '@md/field-group:*:data-[slot=field-label]:flex-auto',
          '@md/field-group:has-[>[data-slot=field-content]]:items-start',
          '@md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
        ],
      },
    },
    defaultVariants: {
      orientation: 'vertical',
    },
  },
);

type FieldProps = ComponentProps<'div'> & VariantProps<typeof fieldVariants>;

/** 单字段布局：标签、控件、说明与错误信息的结构单元。 */
export const Field: Component<FieldProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'orientation']);
  const orientation = () => local.orientation ?? 'vertical';
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation()}
      class={cn(fieldVariants({ orientation: orientation() }), local.class)}
      {...rest}
    />
  );
};

/** 水平字段中包裹标签与说明的纵向内容区。 */
export const FieldContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="field-content"
      class={cn('group/field-content flex flex-1 flex-col gap-2 leading-snug', local.class)}
      {...rest}
    />
  );
};

/** 字段标签；基于 `Label` 并适配 Field 布局语义。 */
export const FieldLabel: Component<ComponentProps<typeof Label>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Label
      data-slot="field-label"
      class={cn(
        'group/field-label peer/field-label flex w-fit leading-snug',
        'gap-8 group-data-[disabled=true]/field:opacity-50',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 字段标题（无 label 关联时使用）。 */
export const FieldTitle: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="field-label"
      class={cn(
        'flex w-fit items-center gap-8 text-13 font-medium leading-snug',
        'group-data-[disabled=true]/field:opacity-50',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 字段辅助说明文案。 */
export const FieldDescription: Component<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <p
      data-slot="field-description"
      class={cn(
        'text-left text-12 font-normal leading-normal text-content-muted',
        'group-has-data-horizontal/field:text-balance last:mt-0',
        '[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-accent-solid',
        local.class,
      )}
      {...rest}
    />
  );
};

type FieldSeparatorProps = ComponentProps<'div'> & {
  children?: JSX.Element;
};

/** 字段组内分隔线，可选居中文案。 */
export const FieldSeparator: Component<FieldSeparatorProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="field-separator"
      data-content={local.children ? true : undefined}
      class={cn(
        'relative -my-8 h-20 text-12',
        'group-data-[variant=outline]/field-group:-mb-8',
        local.class,
      )}
      {...rest}
    >
      <Separator class="absolute inset-0 top-1/2" />
      <Show when={local.children}>
        <span
          data-slot="field-separator-content"
          class="relative mx-auto block w-fit bg-surface px-8 text-content-muted"
        >
          {local.children}
        </span>
      </Show>
    </div>
  );
};

type FieldErrorItem = { message?: string } | undefined;

type FieldErrorProps = ComponentProps<'div'> & {
  errors?: Array<FieldErrorItem>;
  children?: JSX.Element;
};

/** 字段校验错误；支持 children 或 `errors` 数组（去重后渲染）。 */
export const FieldError: Component<FieldErrorProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'errors']);
  const content = createMemo(() => {
    if (local.children) {
      return local.children;
    }
    const errors = local.errors;
    if (!errors?.length) {
      return null;
    }
    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ];
    if (uniqueErrors.length === 1) {
      return uniqueErrors[0]?.message ?? null;
    }
    return (
      <ul class="ml-16 flex list-disc flex-col gap-4">
        {uniqueErrors.map(
          (error, index) => error?.message && <li>{error.message}</li>,
        )}
      </ul>
    );
  });
  return (
    <Show when={content()}>
      <div
        role="alert"
        data-slot="field-error"
        class={cn('text-12 font-normal text-danger', local.class)}
        {...rest}
      >
        {content()}
      </div>
    </Show>
  );
};
