import { Show, splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { CopyButton } from './CopyButton';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from './InputGroup';

type SnippetProps = ComponentProps<'div'> & {
  code: string;
  /** 可选前缀，如终端命令的 `$`。 */
  prefix?: string;
};

/** 行内紧凑代码片段，内置复制按钮。 */
export const Snippet: Component<SnippetProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'code', 'prefix']);
  return (
    <InputGroup
      data-slot="snippet"
      class={cn('h-32 max-w-full font-mono', local.class)}
      {...rest}
    >
      <Show when={local.prefix}>
        <InputGroupAddon>
          <InputGroupText class="font-mono text-12 text-content-muted">{local.prefix}</InputGroupText>
        </InputGroupAddon>
      </Show>
      <InputGroupInput
        value={local.code}
        readOnly
        tabIndex={-1}
        aria-readonly="true"
        class="font-mono text-12 text-content-primary"
      />
      <InputGroupAddon align="inline-end" class="px-4">
        <CopyButton text={local.code} label="Copy" size="compact" />
      </InputGroupAddon>
    </InputGroup>
  );
};
