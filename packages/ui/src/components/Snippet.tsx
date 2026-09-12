import { Check, Copy } from 'lucide-solid';
import {
  createContext,
  createSignal,
  onCleanup,
  Show,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from './InputGroup';

interface SnippetContextValue {
  code: () => string;
}

const SnippetContext = createContext<SnippetContextValue>();

function useSnippet(component: string) {
  const context = useContext(SnippetContext);
  if (!context) {
    throw new Error(`${component} must be used within Snippet`);
  }
  return context;
}

type SnippetProps = ComponentProps<'div'> & {
  code: string;
  /** 便捷 prop：无 children 时在左侧渲染 `$` 前缀。 */
  prefix?: string;
};

/** 紧凑可复制安装命令行（AI Elements snippet）。 */
export const Snippet: Component<SnippetProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'code', 'prefix', 'children']);
  const context: SnippetContextValue = {
    code: () => local.code,
  };

  return (
    <SnippetContext.Provider value={context}>
      <InputGroup
        data-slot="snippet"
        class={cn('h-32 max-w-full font-mono', local.class)}
        {...rest}
      >
        <Show
          when={local.children}
          fallback={
            <>
              <Show when={local.prefix}>
                <SnippetAddon>
                  <SnippetText>{local.prefix}</SnippetText>
                </SnippetAddon>
              </Show>
              <SnippetInput />
              <SnippetAddon align="inline-end" class="px-4">
                <SnippetCopyButton />
              </SnippetAddon>
            </>
          }
        >
          {local.children as JSX.Element}
        </Show>
      </InputGroup>
    </SnippetContext.Provider>
  );
};

export const SnippetAddon: Component<ComponentProps<typeof InputGroupAddon>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return <InputGroupAddon data-slot="snippet-addon" class={local.class} {...rest} />;
};

export const SnippetText: Component<ComponentProps<typeof InputGroupText>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <InputGroupText
      data-slot="snippet-text"
      class={cn('pl-8 font-normal text-content-muted', local.class)}
      {...rest}
    />
  );
};

export const SnippetInput: Component<Omit<ComponentProps<typeof InputGroupInput>, 'readOnly' | 'value'>> = (
  props,
) => {
  const { code } = useSnippet('SnippetInput');
  const [local, rest] = splitProps(props, ['class']);
  return (
    <InputGroupInput
      data-slot="snippet-input"
      class={cn('font-mono text-12 text-content-primary', local.class)}
      readOnly
      value={code()}
      tabIndex={-1}
      aria-readonly="true"
      {...rest}
    />
  );
};

type SnippetCopyButtonProps = ComponentProps<typeof InputGroupButton> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export const SnippetCopyButton: Component<SnippetCopyButtonProps> = (props) => {
  const { code } = useSnippet('SnippetCopyButton');
  const [local, rest] = splitProps(props, ['class', 'onCopy', 'onError', 'timeout', 'children']);
  const [isCopied, setIsCopied] = createSignal(false);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });

  const copyToClipboard = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      local.onError?.(new Error('Clipboard API not available'));
      return;
    }

    try {
      if (!isCopied()) {
        await navigator.clipboard.writeText(code());
        setIsCopied(true);
        local.onCopy?.();
        timeoutId = setTimeout(() => setIsCopied(false), local.timeout ?? 2000);
      }
    } catch (error) {
      local.onError?.(error as Error);
    }
  };

  return (
    <InputGroupButton
      data-slot="snippet-copy-button"
      type="button"
      size="sm"
      aria-label="Copy"
      title="Copy"
      class={local.class}
      onClick={copyToClipboard}
      {...rest}
    >
      <Show when={local.children} fallback={isCopied() ? <Check size={14} /> : <Copy size={14} />}>
        {local.children as JSX.Element}
      </Show>
    </InputGroupButton>
  );
};
