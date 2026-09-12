import { Download } from 'lucide-solid';
import type { CodeBlockViewProps } from '@peri/markdown';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/code/CodeBlock';
import { IconButton } from '@/lib/catalog-ui';
import { downloadText, markdownCodeFilename, safeFilename } from '@peri/ui';

export function MarkdownCodeBlockView(props: CodeBlockViewProps) {
  const locked = () => props.loading === true;
  const filename = () => props.filename || markdownCodeFilename({
    text: props.code,
    language: props.language,
    startLine: props.startLine ?? 1,
    lineNumbers: props.lineNumbers ?? true,
    filename: props.filename ?? '',
  });

  return (
    <CodeBlock
      code={props.code}
      language={props.language}
      filename={filename()}
      showLineNumbers={props.lineNumbers ?? true}
      startLine={props.startLine ?? 1}
      data-incomplete={props.loading ? 'true' : undefined}
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
            onClick={() => downloadText(props.code, safeFilename(filename(), 'snippet.txt'))}
          >
            <Download size={13} />
          </IconButton>
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  );
}
