import {
  createContext,
  createMemo,
  For,
  Show,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../lib/cn';
import { CopyButton } from './CopyButton';

interface CodeBlockContextValue {
  code: () => string;
}

const CodeBlockContext = createContext<CodeBlockContextValue>();

export function useCodeBlock() {
  const context = useContext(CodeBlockContext);
  if (!context) {
    throw new Error('CodeBlock subcomponents must be used within CodeBlock');
  }
  return context;
}

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  css: 'CSS',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  kotlin: 'Kotlin',
  markdown: 'Markdown',
  md: 'Markdown',
  php: 'PHP',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  ruby: 'Ruby',
  rs: 'Rust',
  rust: 'Rust',
  sh: 'Shell',
  shell: 'Shell',
  sql: 'SQL',
  swift: 'Swift',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
  zsh: 'Zsh',
};

function formatLanguage(language: string) {
  const normalized = language.toLowerCase();
  return LANGUAGE_LABELS[normalized] ?? (normalized === 'text' ? 'Plain text' : language);
}

type CodeBlockRootProps = ComponentProps<'div'> & {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  startLine?: number;
};

/** 代码块容器：提供 code 上下文，默认渲染语言标签、复制按钮与 pre/code 正文。 */
export const CodeBlock: Component<CodeBlockRootProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'code',
    'language',
    'filename',
    'showLineNumbers',
    'startLine',
    'children',
  ]);
  const context: CodeBlockContextValue = {
    code: () => local.code.replace(/\n$/, ''),
  };

  return (
    <CodeBlockContext.Provider value={context}>
      <div
        data-slot="code-block"
        class={cn(
          'my-16 overflow-hidden rounded-8 border border-border-subtle bg-surface-overlay',
          local.class,
        )}
        {...rest}
      >
        <Show
          when={local.children}
          fallback={
            <>
              <CodeBlockHeader>
                <CodeBlockTitle language={local.language} />
                <Show when={local.filename}>
                  <span class="min-w-0 truncate text-12 text-content-muted">{local.filename}</span>
                </Show>
                <CodeBlockActions>
                  <CodeBlockCopyButton />
                </CodeBlockActions>
              </CodeBlockHeader>
              <CodeBlockBody
                showLineNumbers={local.showLineNumbers}
                startLine={local.startLine}
              />
            </>
          }
        >
          {local.children}
        </Show>
      </div>
    </CodeBlockContext.Provider>
  );
};

export const CodeBlockHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="code-block-header"
      class={cn(
        'flex min-h-36 items-center gap-8 border-b border-border-subtle px-8 py-4',
        local.class,
      )}
      {...rest}
    />
  );
};

export const CodeBlockTitle: Component<ComponentProps<'span'> & { language?: string }> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'language', 'children']);
  const label = () =>
    local.children ?? formatLanguage(local.language ?? 'text');
  return (
    <span
      data-slot="code-block-title"
      class={cn('mr-auto min-w-0 truncate text-12 font-medium text-content-secondary', local.class)}
      {...rest}
    >
      {label()}
    </span>
  );
};

export const CodeBlockActions: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="code-block-actions"
      class={cn('flex shrink-0 items-center gap-4', local.class)}
      {...rest}
    />
  );
};

export const CodeBlockCopyButton: Component<
  Omit<ComponentProps<typeof CopyButton>, 'text'> & { text?: string }
> = (props) => {
  const { code } = useCodeBlock();
  const [local, rest] = splitProps(props, ['text', 'label', 'size']);
  return (
    <CopyButton
      text={local.text ?? code()}
      label={local.label ?? 'Copy code'}
      size={local.size ?? 'compact'}
      {...rest}
    />
  );
};

type CodeBlockBodyProps = ComponentProps<'pre'> & {
  code?: string;
  showLineNumbers?: boolean;
  startLine?: number;
};

export const CodeBlockBody: Component<CodeBlockBodyProps> = (props) => {
  const { code } = useCodeBlock();
  const [local, rest] = splitProps(props, [
    'class',
    'code',
    'showLineNumbers',
    'startLine',
    'children',
  ]);
  const source = createMemo(() => (local.code ?? code()).replace(/\n$/, ''));
  const lines = createMemo(() => source().split('\n'));
  const startLine = () => local.startLine ?? 1;

  return (
    <pre
      data-slot="code-block-body"
      class={cn(
        'm-0 max-h-520 overflow-auto bg-surface-sunken px-0 py-12 font-mono text-12 leading-relaxed text-content-primary',
        local.class,
      )}
      {...rest}
    >
      <code class="block min-w-max bg-transparent p-0 font-mono text-inherit">
        <Show
          when={local.children}
          fallback={
            <For each={lines()}>
              {(line, index) => (
                <span
                  class={cn(
                    'grid min-h-18 px-14',
                    local.showLineNumbers ? 'grid-cols-code-line' : 'grid-cols-1',
                  )}
                >
                  <Show when={local.showLineNumbers}>
                    <span
                      class="mr-14 min-w-20 select-none text-right text-content-faint"
                      aria-hidden="true"
                    >
                      {startLine() + index()}
                    </span>
                  </Show>
                  <span class="whitespace-pre">
                    {line}
                    {index() < lines().length - 1 ? '\n' : ''}
                  </span>
                </span>
              )}
            </For>
          }
        >
          {local.children}
        </Show>
      </code>
    </pre>
  );
};
