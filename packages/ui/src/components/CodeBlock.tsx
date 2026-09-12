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
import { filePathBasename } from '../lib/vscode-file-icons';
import { CopyButton } from './CopyButton';
import { Select, type SelectOption } from './Select';
import { VSCodeFileIcon } from './VSCodeFileIcon';

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
  text: 'Plain text',
};

function formatLanguage(language: string) {
  const normalized = language.toLowerCase();
  return LANGUAGE_LABELS[normalized] ?? language;
}

type CodeBlockContainerProps = ComponentProps<'div'> & {
  language: string;
};

export const CodeBlockContainer: Component<CodeBlockContainerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'language', 'style']);
  return (
    <div
      data-slot="code-block-container"
      data-language={local.language}
      class={cn(
        'group relative my-16 w-full overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay text-content-primary',
        local.class,
      )}
      style={{
        'contain-intrinsic-size': 'auto 200px',
        'content-visibility': 'auto',
        ...(typeof local.style === 'object' && local.style !== null ? local.style : {}),
      }}
      {...rest}
    />
  );
};

export const CodeBlockHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="code-block-header"
      class={cn(
        'flex min-h-36 items-center gap-8 border-b border-border-subtle px-8 py-4 text-12 text-content-muted',
        local.class,
      )}
      {...rest}
    />
  );
};

export const CodeBlockTitle: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="code-block-title"
      class={cn('mr-auto flex min-w-0 flex-1 items-center gap-8', local.class)}
      {...rest}
    />
  );
};

type CodeBlockFilenameProps = ComponentProps<'span'> & {
  /** 文件路径：渲染 VS Code 风格图标；未传 children 时用 basename 作标签。 */
  path?: string;
};

export const CodeBlockFilename: Component<CodeBlockFilenameProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'path', 'children']);
  const label = () => {
    if (local.children != null && local.children !== false && local.children !== true) {
      return local.children;
    }
    return local.path ? filePathBasename(local.path) : null;
  };

  return (
    <span
      data-slot="code-block-filename"
      class={cn('flex min-w-0 items-center gap-6 font-mono text-12 text-content-secondary', local.class)}
      {...rest}
    >
      <Show when={local.path}>
        <VSCodeFileIcon path={local.path!} size={14} class="size-14" />
      </Show>
      <span class="truncate">{label()}</span>
    </span>
  );
};

export const CodeBlockActions: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="code-block-actions"
      class={cn('-my-4 -mr-4 flex shrink-0 items-center gap-8', local.class)}
      {...rest}
    />
  );
};

export const CodeBlockCopyButton: Component<
  Omit<ComponentProps<typeof CopyButton>, 'text'> & {
    text?: string;
    onCopy?: () => void;
    onError?: (error: Error) => void;
    timeout?: number;
  }
> = (props) => {
  const { code } = useCodeBlock();
  const [local, rest] = splitProps(props, ['text', 'label', 'size', 'onCopy', 'onError', 'timeout']);
  return (
    <CopyButton
      text={local.text ?? code()}
      label={local.label ?? 'Copy code'}
      size={local.size ?? 'compact'}
      {...rest}
    />
  );
};

type CodeBlockLanguageSelectorProps = {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  class?: string;
  disabled?: boolean;
  'aria-label'?: string;
};

/** 代码块语言切换：Peri Select plain 变体封装。 */
export const CodeBlockLanguageSelector: Component<CodeBlockLanguageSelectorProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Select
      variant="plain"
      class={cn('h-28 min-w-0 px-8 text-12', local.class)}
      {...rest}
    />
  );
};

export const CodeBlockLanguageSelectorTrigger: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="code-block-language-selector-trigger"
      class={cn('inline-flex h-28 items-center', local.class)}
      {...rest}
    />
  );
};

export const CodeBlockLanguageSelectorValue: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <span
      data-slot="code-block-language-selector-value"
      class={cn('text-12 text-content-secondary', local.class)}
      {...rest}
    />
  );
};

export const CodeBlockLanguageSelectorContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="code-block-language-selector-content"
      class={cn('hidden', local.class)}
      aria-hidden="true"
      {...rest}
    />
  );
};

export const CodeBlockLanguageSelectorItem: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="code-block-language-selector-item"
      class={cn('hidden', local.class)}
      aria-hidden="true"
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
        'm-0 max-h-320 overflow-auto bg-surface-sunken px-12 py-12 font-mono text-12 leading-relaxed text-content-primary',
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
                    'grid min-h-18 gap-8',
                    local.showLineNumbers ? 'grid-cols-code-line' : 'grid-cols-1',
                  )}
                >
                  <Show when={local.showLineNumbers}>
                    <span
                      class="select-none text-right tabular-nums text-content-faint"
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

type CodeBlockContentProps = {
  code?: string;
  showLineNumbers?: boolean;
  startLine?: number;
  class?: string;
};

export const CodeBlockContent: Component<CodeBlockContentProps> = (props) => (
  <div class="relative overflow-auto">
    <CodeBlockBody
      code={props.code}
      showLineNumbers={props.showLineNumbers}
      startLine={props.startLine}
      class={props.class}
    />
  </div>
);

type CodeBlockRootProps = ComponentProps<'div'> & {
  code: string;
  language?: string;
  /** 默认 header 文件名；有值时显示 VSCodeFileIcon + basename。 */
  filename?: string;
  showLineNumbers?: boolean;
  startLine?: number;
  /** 为 false 时仅渲染 children，不自动追加默认 CodeBlockContent（供语法高亮等自定义 body）。 */
  includeDefaultBody?: boolean;
};

/** 代码块根：提供 code 上下文；可组合 header/actions 或走默认布局。 */
export const CodeBlock: Component<CodeBlockRootProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'code',
    'language',
    'filename',
    'showLineNumbers',
    'startLine',
    'includeDefaultBody',
    'children',
  ]);
  const language = () => local.language ?? 'text';
  const context: CodeBlockContextValue = {
    code: () => local.code.replace(/\n$/, ''),
  };

  return (
    <CodeBlockContext.Provider value={context}>
      <CodeBlockContainer language={language()} data-slot="code-block" class={local.class} {...rest}>
        <Show
          when={local.children}
          fallback={
            <>
              <CodeBlockHeader>
                <CodeBlockTitle>
                  <Show
                    when={local.filename}
                    fallback={<CodeBlockFilename>{formatLanguage(language())}</CodeBlockFilename>}
                  >
                    <CodeBlockFilename path={local.filename} />
                  </Show>
                </CodeBlockTitle>
                <CodeBlockActions>
                  <CodeBlockCopyButton />
                </CodeBlockActions>
              </CodeBlockHeader>
              <CodeBlockContent
                showLineNumbers={local.showLineNumbers}
                startLine={local.startLine}
              />
            </>
          }
        >
          {local.children}
          <Show when={local.includeDefaultBody !== false}>
            <CodeBlockContent
              showLineNumbers={local.showLineNumbers}
              startLine={local.startLine}
            />
          </Show>
        </Show>
      </CodeBlockContainer>
    </CodeBlockContext.Provider>
  );
};
