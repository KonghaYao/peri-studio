import { Download } from 'lucide-solid';
import { createMemo, For, Show, type JSX } from 'solid-js';
import { CopyButton, IconButton } from '@/lib/catalog-ui';
import { downloadText, safeFilename } from './download';
import { MathExpression } from './Math';
import { MermaidBlock } from './MermaidBlock';

type CodeElement = HTMLElement & { props?: Record<string, unknown> };

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', js: 'JavaScript', javascript: 'JavaScript',
  json: 'JSON', rust: 'Rust', rs: 'Rust', py: 'Python', python: 'Python', sh: 'Shell',
  mermaid: 'Mermaid', math: 'Math', text: 'Plain text',
};

const EXTENSIONS: Record<string, string> = { javascript: 'js', typescript: 'ts', python: 'py', rust: 'rs', markdown: 'md' };

function childDetails(child: unknown) {
  const element = (Array.isArray(child) ? child[0] : child) as CodeElement | undefined;
  const rawProps = element?.props || {};
  const text = element instanceof HTMLElement ? element.textContent || '' : String(rawProps.children ?? child ?? '');
  const className = element instanceof HTMLElement ? element.className : String(rawProps.class ?? '');
  const language = className.match(/(?:language|lang)-([^\s]+)/)?.[1]?.toLowerCase() || 'text';
  const attr = (name: string) => (element instanceof HTMLElement ? element.getAttribute(name) : rawProps[name]);
  const startLine = Math.max(1, Number(attr('startLine') ?? attr('startline') ?? 1) || 1);
  const lineNumbers = attr('noLineNumbers') == null && attr('nolinenumbers') == null;
  const filename = String(attr('filename') ?? '').trim();
  return { text: text.replace(/\n$/, ''), language, startLine, lineNumbers, filename };
}

export function CodeBlock(props: JSX.HTMLAttributes<HTMLPreElement> & { streaming?: boolean; incomplete?: boolean }) {
  const details = createMemo(() => childDetails(props.children));
  const locked = () => props.streaming === true && props.incomplete === true;
  const lines = () => details().text.split('\n');
  const label = () => LANGUAGE_LABELS[details().language] || details().language;
  const extension = () => EXTENSIONS[details().language] || details().language || 'txt';

  if (details().language === 'math' && locked()) {
    return (
      <div class="my-4 overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-incomplete="true">
        <pre class="m-0 overflow-auto bg-surface-sunken px-3 py-2.5 font-mono text-12"><code>{details().text}</code></pre>
      </div>
    );
  }
  if (details().language === 'math') return <MathExpression expression={details().text.trim()} block />;
  if (details().language === 'mermaid') {
    return (
      <div class="my-4 overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-incomplete={props.incomplete ? 'true' : undefined}>
        <MermaidBlock code={details().text} incomplete={locked()} />
      </div>
    );
  }

  return (
    <div class="my-4 overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-incomplete={props.incomplete ? 'true' : undefined}>
      <div class="flex min-h-8 items-center gap-2 border-b border-border-subtle px-2 py-1">
        <span class="mr-auto flex min-w-0 items-center gap-2 text-12 text-content-secondary">
          <strong class="font-medium">{label()}</strong>
          <Show when={details().filename}><span class="truncate text-content-muted">{details().filename}</span></Show>
        </span>
        <CopyButton text={details().text} label="Copy code" disabled={locked()} />
        <IconButton
          size="sm"
          label="Download code"
          disabled={locked()}
          onClick={() => downloadText(details().text, safeFilename(details().filename || `snippet.${extension()}`, 'snippet.txt'))}
        >
          <Download size={13} />
        </IconButton>
      </div>
      <pre class="m-0 max-h-80 overflow-auto bg-surface-sunken py-3 font-mono text-12 leading-relaxed text-content-primary">
        <code class="block min-w-max bg-transparent p-0">
          <For each={lines()}>
            {(line, index) => (
              <span class="grid min-h-4.5 grid-cols-code-line px-3.5">
                <Show when={details().lineNumbers}>
                  <span class="mr-3.5 min-w-5 select-none text-right text-content-faint" aria-hidden="true">{details().startLine + index()}</span>
                </Show>
                <span class="whitespace-pre">{line}{index() < lines().length - 1 ? '\n' : ''}</span>
              </span>
            )}
          </For>
        </code>
      </pre>
    </div>
  );
}
