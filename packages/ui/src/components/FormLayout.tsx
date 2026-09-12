import { createMemo, createSignal, Show, splitProps, type Component, type ComponentProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './Form';

export type FormLayoutMode = 'horizontal' | 'vertical' | 'inline';
export type FormLabelAlign = 'left' | 'right';

export type FormLayoutProps = ComponentProps<'form'> & {
  layout?: FormLayoutMode;
  labelAlign?: FormLabelAlign;
  labelCol?: { span?: number };
  wrapperCol?: { span?: number };
  errors?: Record<string, string | undefined>;
};

const layoutClasses: Record<FormLayoutMode, string> = {
  horizontal: 'flex flex-col gap-12',
  vertical: 'flex flex-col gap-12',
  inline: 'flex flex-wrap items-end gap-12',
};

/** 表单布局容器：horizontal / vertical / inline + labelAlign。 */
export const FormLayout: Component<FormLayoutProps> = (props) => {
  const [local, rest] = splitProps(props, ['layout', 'labelAlign', 'labelCol', 'wrapperCol', 'errors', 'class', 'children']);
  const layout = () => local.layout ?? 'vertical';
  const align = () => local.labelAlign ?? 'right';

  return (
    <Form errors={local.errors} class={cn(layoutClasses[layout()], local.class)} data-label-align={align()} {...rest}>
      {local.children}
    </Form>
  );
};

export type FormFieldStatus = 'success' | 'warning' | 'error' | 'validating';

export type FormFieldItemProps = {
  name: string;
  label: string;
  help?: string;
  extra?: string;
  required?: boolean;
  validateStatus?: FormFieldStatus;
  children: JSX.Element;
};

/** 带 validateStatus / help / extra 的字段行。 */
export const FormFieldItem: Component<FormFieldItemProps> = (props) => (
  <FormField name={props.name}>
    <FormItem data-validate-status={props.validateStatus}>
      <FormLabel>
        {props.label}
        <Show when={props.required}><span class="text-danger"> *</span></Show>
      </FormLabel>
      <FormControl>{props.children}</FormControl>
      <Show when={props.help}>
        <FormDescription>{props.help}</FormDescription>
      </Show>
      <Show when={props.extra}>
        <p class="text-12 text-text-muted">{props.extra}</p>
      </Show>
      <FormMessage />
    </FormItem>
  </FormField>
);

export type FormListProps = {
  name: string;
  initialValue?: string[];
  children: (fields: Array<{ key: number; name: string }>, actions: { add: () => void; remove: (index: number) => void }) => JSX.Element;
};

/** 动态字段列表，对齐 Ant Design Form.List。 */
export const FormList: Component<FormListProps> = (props) => {
  const [fields, setFields] = createSignal(
    (props.initialValue ?? ['']).map((_, index) => ({ key: index, name: `${props.name}.${index}` })),
  );

  const add = () => {
    setFields((current) => [...current, { key: current.length, name: `${props.name}.${current.length}` }]);
  };

  const remove = (index: number) => {
    setFields((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  return props.children(fields(), { add, remove });
};

export function FormListField(props: { label: string; name: string; children: JSX.Element }) {
  return (
    <FormField name={props.name}>
      <FormItem>
        <FormLabel>{props.label}</FormLabel>
        <FormControl>{props.children}</FormControl>
      </FormItem>
    </FormField>
  );
}

export const FormListActions: Component<{ onAdd: () => void }> = (props) => (
  <Button variant="dashed" size="sm" onClick={props.onAdd}>Add field</Button>
);

export type FormDependencyProps = {
  /** 监听的字段名列表，对齐 Ant Design Form.Item dependencies。 */
  dependencies: string[];
  /** 当前表单值快照，由调用方维护。 */
  values: Record<string, unknown>;
  children: (deps: Record<string, unknown>) => JSX.Element;
};

/** 字段依赖渲染：当 dependencies 对应值变化时重渲染 children。 */
export const FormDependency: Component<FormDependencyProps> = (props) => {
  const picked = createMemo(() => {
    const result: Record<string, unknown> = {};
    for (const key of props.dependencies) {
      result[key] = props.values[key];
    }
    return result;
  });
  return props.children(picked());
};
