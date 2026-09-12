import {
  createContext,
  createRenderEffect,
  createUniqueId,
  onMount,
  Show,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
  type ParentComponent,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Label } from './Label';

type FormContextValue = {
  errors?: Record<string, string | undefined>;
};

type FormFieldContextValue = {
  name: () => string;
  error: () => string | undefined;
  invalid: () => boolean;
};

type FormItemContextValue = {
  id: () => string;
  descriptionId: () => string;
  messageId: () => string;
  error: () => string | undefined;
  invalid: () => boolean;
  describedBy: () => string | undefined;
};

const FormContext = createContext<FormContextValue>();
const FormFieldContext = createContext<FormFieldContextValue>();
const FormItemContext = createContext<FormItemContextValue>();

function useFormFieldContext(component: string) {
  const context = useContext(FormFieldContext);
  if (!context) {
    throw new Error(`${component} must be used within FormField`);
  }
  return context;
}

function useFormItemContext(component: string) {
  const context = useContext(FormItemContext);
  if (!context) {
    throw new Error(`${component} must be used within FormItem`);
  }
  return context;
}

export type FormFieldRenderProps = {
  name: string;
  error: string | undefined;
  invalid: boolean;
};

/** 可选表单上下文：集中提供字段级错误映射。 */
export const Form: Component<ComponentProps<'form'> & { errors?: Record<string, string | undefined> }> = (props) => {
  const [local, rest] = splitProps(props, ['errors', 'class', 'children']);
  return (
    <FormContext.Provider value={{ errors: local.errors }}>
      <form class={cn(local.class)} {...rest}>
        {local.children}
      </form>
    </FormContext.Provider>
  );
};

type FormFieldProps = {
  name: string;
  error?: string;
  children?: JSX.Element | ((field: FormFieldRenderProps) => JSX.Element);
};

/** 命名字段上下文；支持 children 或 render props，不绑定具体表单库。 */
export const FormField: Component<FormFieldProps> = (props) => {
  const form = useContext(FormContext);
  const error = () => props.error ?? form?.errors?.[props.name];
  const invalid = () => !!error();
  const field: FormFieldRenderProps = {
    get name() { return props.name; },
    get error() { return error(); },
    get invalid() { return invalid(); },
  };

  const content = () => (typeof props.children === 'function' ? props.children(field) : props.children);

  return (
    <FormFieldContext.Provider value={{ name: () => props.name, error, invalid }}>
      {content()}
    </FormFieldContext.Provider>
  );
};

/** 垂直堆叠的字段项容器，生成 id 与 aria 关联 id。 */
export const FormItem: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'id', 'children']);
  const generated = createUniqueId();
  const id = () => local.id ?? `form-item-${generated}`;
  const descriptionId = () => `${id()}-description`;
  const messageId = () => `${id()}-message`;
  const field = useContext(FormFieldContext);
  const error = () => field?.error();
  const invalid = () => !!error();
  const describedBy = () => {
    const ids = [descriptionId()];
    if (invalid()) ids.push(messageId());
    return ids.join(' ');
  };

  return (
    <FormItemContext.Provider value={{ id, descriptionId, messageId, error, invalid, describedBy }}>
      <div class={cn('flex flex-col gap-6', local.class)} {...rest}>
        {local.children}
      </div>
    </FormItemContext.Provider>
  );
};

/** 关联控件 id 的字段标签。 */
export const FormLabel: Component<ComponentProps<typeof Label>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const item = useFormItemContext('FormLabel');
  return <Label for={item.id()} class={local.class} {...rest} />;
};

/** 将 id 与 aria 属性合并到唯一子控件。 */
export const FormControl: ParentComponent = (props) => {
  const item = useFormItemContext('FormControl');
  let container: HTMLDivElement | undefined;

  const applyA11y = () => {
    const control = container?.firstElementChild;
    if (!(control instanceof HTMLElement)) return;
    control.id = item.id();
    if (item.invalid()) {
      control.setAttribute('aria-invalid', 'true');
    } else {
      control.removeAttribute('aria-invalid');
    }
    const describedBy = item.describedBy();
    if (describedBy) {
      control.setAttribute('aria-describedby', describedBy);
    } else {
      control.removeAttribute('aria-describedby');
    }
  };

  onMount(applyA11y);
  createRenderEffect(applyA11y);

  return (
    <div ref={container} class="contents">
      {props.children}
    </div>
  );
};

/** 辅助说明文案。 */
export const FormDescription: Component<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const item = useFormItemContext('FormDescription');
  return (
    <p id={item.descriptionId()} class={cn('text-12 text-text-muted', local.class)} {...rest} />
  );
};

/** 字段错误文案；默认读取 FormField 错误，也可显式传入 children。 */
export const FormMessage: Component<ComponentProps<'p'> & { children?: JSX.Element }> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const item = useFormItemContext('FormMessage');
  const body = () => local.children ?? item.error();
  return (
    <Show when={body()}>
      <p id={item.messageId()} class={cn('m-0 text-13 text-danger', local.class)} {...rest}>
        {body()}
      </p>
    </Show>
  );
};

/** 组合 FormField + FormItem 上下文，供自定义控件读取关联元数据。 */
export function useFormField(): FormFieldRenderProps & {
  formItemId: string;
  formDescriptionId: string;
  formMessageId: string;
} {
  const field = useFormFieldContext('useFormField');
  const item = useFormItemContext('useFormField');
  return {
    name: field.name(),
    error: field.error(),
    invalid: field.invalid(),
    formItemId: item.id(),
    formDescriptionId: item.descriptionId(),
    formMessageId: item.messageId(),
  };
}
