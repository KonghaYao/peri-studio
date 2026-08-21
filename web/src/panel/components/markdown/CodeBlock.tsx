import { createMemo, createResource, For, Show, type JSX } from 'solid-js';
import { CopyButton, DownloadIcon, IconButton, RefreshIcon } from '../../../components/ui';
import { memoizeAsync } from './async-cache';
import { downloadText, safeFilename } from './download';
import { MathExpression } from './Math';
import { MermaidBlock } from './MermaidBlock';

type CodeElement = HTMLElement & { props?: Record<string, unknown> };

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'bash', c: 'c', cpp: 'cpp', css: 'css', go: 'go', html: 'html', java: 'java', js: 'javascript', javascript: 'javascript', json: 'json', jsx: 'jsx', kotlin: 'kotlin', markdown: 'markdown', md: 'markdown', php: 'php', py: 'python', python: 'python', rb: 'ruby', ruby: 'ruby', rs: 'rust', rust: 'rust', sh: 'shellscript', shell: 'shellscript', sql: 'sql', swift: 'swift', ts: 'typescript', tsx: 'tsx', typescript: 'typescript', xml: 'xml', yaml: 'yaml', yml: 'yaml', zsh: 'zsh',
};

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash', c: 'C', cpp: 'C++', css: 'CSS', go: 'Go', html: 'HTML', java: 'Java', javascript: 'JavaScript', json: 'JSON', jsx: 'JSX', kotlin: 'Kotlin', markdown: 'Markdown', php: 'PHP', python: 'Python', ruby: 'Ruby', rust: 'Rust', shellscript: 'Shell', sql: 'SQL', swift: 'Swift', typescript: 'TypeScript', tsx: 'TSX', xml: 'XML', yaml: 'YAML', zsh: 'Zsh', mermaid: 'Mermaid', math: 'Math',
};

const EXTENSIONS: Record<string, string> = { javascript: 'js', markdown: 'md', python: 'py', rust: 'rs', shellscript: 'sh', typescript: 'ts', yaml: 'yml' };

function childDetails(child: unknown) {
  const element = (Array.isArray(child) ? child[0] : child) as CodeElement | undefined;
  const rawProps = element?.props || {};
  const text = element instanceof HTMLElement ? element.textContent || '' : String(rawProps.children ?? child ?? '');
  const className = element instanceof HTMLElement ? element.className : String(rawProps.class ?? '');
  const language = className.match(/(?:language|lang)-([^\s]+)/)?.[1]?.toLowerCase() || 'text';
  const attr = (name: string) => element instanceof HTMLElement ? element.getAttribute(name) : rawProps[name];
  const startLine = Math.max(1, Number(attr('startLine') ?? attr('startline') ?? 1) || 1);
  const lineNumbers = attr('noLineNumbers') == null && attr('nolinenumbers') == null;
  const filename = String(attr('filename') ?? '').trim();
  return { text: text.replace(/\n$/, ''), language, startLine, lineNumbers, filename };
}

async function loadHighlight(code: string, language: string) {
  const { bundledLanguages, codeToTokens } = await import('shiki');
  if (!(language in bundledLanguages)) return { result: null, error: false };
  return { result: await codeToTokens(code, { lang: language as keyof typeof bundledLanguages, theme: 'github-light-default' }), error: false };
}

const loadHighlightCached = memoizeAsync((code: string, language: string) => `${language}\u0000${code}`, loadHighlight);

async function highlight(code: string, language: string) {
  const normalized = LANGUAGE_ALIASES[language] || language;
  try {
    return await loadHighlightCached(code, normalized);
  } catch {
    return { result: null, error: true };
  }
}

function tokenStyle(token: { content: string; color?: string; fontStyle?: number }) {
  return {
    color: token.color,
    'font-style': token.fontStyle && token.fontStyle & 1 ? 'italic' : undefined,
    'font-weight': token.fontStyle && token.fontStyle & 2 ? '600' : undefined,
    'text-decoration': token.fontStyle && token.fontStyle & 4 ? 'underline' : undefined,
  } as JSX.CSSProperties;
}

export function CodeBlock(props: JSX.HTMLAttributes<HTMLPreElement> & { streaming?: boolean; incomplete?: boolean }) {
  const details = createMemo(() => childDetails(props.children));
  const locked = () => props.streaming === true && props.incomplete === true;
  const canHighlight = () => !locked() && details().language !== 'math' && details().language !== 'mermaid';
  const [highlighted, { refetch }] = createResource(
    () => canHighlight() ? [details().text, details().language] as const : null,
    ([code, language]) => highlight(code, language),
  );
  const lines = () => highlighted()?.result?.tokens || details().text.split('\n').map((line) => [{ content: line }]);
  const language = () => LANGUAGE_ALIASES[details().language] || details().language;
  const label = () => LANGUAGE_LABELS[language()] || (details().language === 'text' ? 'Plain text' : details().language);
  const extension = () => EXTENSIONS[language()] || details().language || 'txt';

  if (details().language === 'math' && locked()) return <div class="md-code-block my-12 overflow-hidden rounded-10 border border-border-subtle bg-surface" data-highlighted="false" data-incomplete="true"><pre class="m-0 overflow-auto bg-sidebar-bg px-14 py-13 text-12p5 leading-18"><code class="bg-transparent p-0 text-inherit">{details().text}</code></pre></div>;
  if (details().language === 'math') return <MathExpression expression={details().text.trim()} block />;
  if (details().language === 'mermaid') return <div class="md-code-block my-12 overflow-hidden rounded-10 border border-border-subtle bg-surface" data-incomplete={props.incomplete ? 'true' : undefined}><MermaidBlock code={details().text} incomplete={locked()} /></div>;

  return <div class="md-code-block my-12 overflow-hidden rounded-10 border border-border-subtle bg-surface" data-highlighted={highlighted()?.result ? 'true' : 'false'} data-incomplete={props.incomplete ? 'true' : undefined}>
    <div class="md-code-toolbar flex min-h-38 items-center gap-4 border-b border-divider px-8 py-5">
      <span class="mr-auto flex min-w-0 items-center gap-8 text-12 text-text-secondary"><strong class="font-600">{label()}</strong><Show when={details().filename}><span class="truncate text-text-tertiary">{details().filename}</span></Show></span>
      <Show when={highlighted()?.error}><IconButton size="compact" onClick={() => refetch()} label="Retry syntax highlighting"><RefreshIcon /></IconButton></Show>
      <CopyButton text={details().text} label="Copy code" size="compact" disabled={locked()} />
      <IconButton size="compact" disabled={locked()} onClick={() => downloadText(details().text, safeFilename(details().filename || `snippet.${extension()}`, 'snippet.txt'))} label="Download code"><DownloadIcon /></IconButton>
    </div>
    <pre class="m-0 max-h-520 overflow-auto bg-sidebar-bg px-0 py-12 text-12p5 leading-18 text-text-primary"><code class="block min-w-max bg-transparent p-0 font-mono text-inherit">
      <For each={lines()}>{(line, index) => <span class="md-code-line grid min-h-18 grid-cols-[auto_1fr] px-14">
        <Show when={details().lineNumbers}><span class="md-code-line__number mr-14 min-w-20 select-none text-right text-text-tertiary" aria-hidden="true">{details().startLine + index()}</span></Show>
        <span class="whitespace-pre"><For each={line}>{(token) => <span style={tokenStyle(token)}>{token.content}</span>}</For>{index() < lines().length - 1 ? '\n' : ''}</span>
      </span>}</For>
    </code></pre>
  </div>;
}
