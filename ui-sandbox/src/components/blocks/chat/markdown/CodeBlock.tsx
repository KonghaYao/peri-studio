import { Download } from 'lucide-solid';
import { createMemo, type JSX } from 'solid-js';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/code/CodeBlock';
import { IconButton } from '@/lib/catalog-ui';
import { downloadText, markdownCodeFilename, parseMarkdownPreChild, safeFilename } from '@peri/ui';
import { MathExpression } from './Math';
import { MermaidBlock } from './MermaidBlock';

export function MarkdownCodeBlock(props: JSX.HTMLAttributes<HTMLPreElement> & { streaming?: boolean; incomplete?: boolean }) {
  const details = createMemo(() => parseMarkdownPreChild(props.children));
  const locked = () => props.streaming === true && props.incomplete === true;
  const filename = () => markdownCodeFilename(details());
  const downloadName = () => safeFilename(filename(), 'snippet.txt');

  if (details().language === 'math' && locked()) {
    return (
      <div class="my-16 overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-incomplete="true">
        <pre class="m-0 overflow-auto bg-surface-sunken px-12 py-10 font-mono text-12"><code>{details().text}</code></pre>
      </div>
    );
  }
  if (details().language === 'math') return <MathExpression expression={details().text.trim()} block />;
  if (details().language === 'mermaid') {
    return (
      <div class="my-16 overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-incomplete={props.incomplete ? 'true' : undefined}>
        <MermaidBlock code={details().text} incomplete={locked()} />
      </div>
    );
  }

  return (
    <CodeBlock
      code={details().text}
      language={details().language}
      filename={filename()}
      showLineNumbers={details().lineNumbers}
      startLine={details().startLine}
      data-incomplete={props.incomplete ? 'true' : undefined}
    >
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename path={filename()} />
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton disabled={locked()} />
          <IconButton
            size="sm"
            label="Download code"
            disabled={locked()}
            onClick={() => downloadText(details().text, downloadName())}
          >
            <Download size={13} />
          </IconButton>
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  );
}
