import { createMemo, Show } from 'solid-js';
import type { CodeBlockViewProps } from '@peri/markdown';
import { downloadText, safeFilename } from '../../lib/download';
import { hasSyntaxHighlighting } from '../../lib/code-highlight';
import { markdownCodeFilename } from '../../lib/parse-markdown-pre-child';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockBody,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from '../CodeBlock';
import { IconButton } from '../Button';
import { DownloadIcon } from '../Icon';
import { HighlightedCodeBody } from '../HighlightedCodeBody';

export function MarkdownCodeBlockView(props: CodeBlockViewProps) {
  const locked = () => props.loading === true;
  const canHighlight = () => !locked();
  const isHighlighted = createMemo(() => (
    canHighlight() && hasSyntaxHighlighting(props.code, props.language)
  ));
  const filename = () => props.filename || markdownCodeFilename({
    text: props.code,
    language: props.language,
    startLine: props.startLine ?? 1,
    lineNumbers: props.lineNumbers ?? true,
    filename: props.filename ?? '',
  });

  return (
    <CodeBlock
      class="md-code-block"
      code={props.code}
      language={props.language}
      filename={filename()}
      showLineNumbers={props.lineNumbers ?? true}
      startLine={props.startLine ?? 1}
      includeDefaultBody={false}
      data-testid="md-code-block"
      data-highlighted={isHighlighted() ? 'true' : 'false'}
      data-incomplete={props.loading ? 'true' : undefined}
    >
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename path={filename()} />
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton disabled={locked()} />
          <IconButton
            size="compact"
            disabled={locked()}
            onClick={() => downloadText(props.code, safeFilename(filename(), 'snippet.txt'))}
            label="Download code"
          >
            <DownloadIcon />
          </IconButton>
        </CodeBlockActions>
      </CodeBlockHeader>
      <Show
        when={canHighlight()}
        fallback={
          <div class="relative overflow-auto">
            <CodeBlockBody
              showLineNumbers={props.lineNumbers ?? true}
              startLine={props.startLine ?? 1}
              class="max-h-520"
            />
          </div>
        }
      >
        <HighlightedCodeBody
          language={props.language}
          showLineNumbers={props.lineNumbers ?? true}
          startLine={props.startLine ?? 1}
        />
      </Show>
    </CodeBlock>
  );
}
