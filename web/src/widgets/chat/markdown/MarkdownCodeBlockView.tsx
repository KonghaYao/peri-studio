import { createResource, Show } from 'solid-js';
import type { CodeBlockViewProps } from '@peri/markdown';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
  DownloadIcon,
  IconButton,
  RefreshIcon,
} from '@peri/ui';
import { downloadText, safeFilename } from './download';
import { markdownCodeFilename } from './parse-pre-child';
import { ShikiHighlightedCodeBody } from './ShikiHighlightedCodeBody';
import { highlightCode } from './highlight-code';

export function MarkdownCodeBlockView(props: CodeBlockViewProps) {
  const locked = () => props.loading === true;
  const canHighlight = () => !locked();
  const [highlighted, { refetch }] = createResource(
    () => (canHighlight() ? [props.code, props.language] as const : null),
    ([code, language]) => highlightCode(code, language),
  );
  const filename = () => props.filename || markdownCodeFilename({
    text: props.code,
    language: props.language,
    startLine: props.startLine ?? 1,
    lineNumbers: props.lineNumbers ?? true,
    filename: props.filename ?? '',
  });
  const lines = () => highlighted()?.result?.tokens
    ?? props.code.split('\n').map((line) => [{ content: line }]);

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
      data-highlighted={highlighted()?.result ? 'true' : 'false'}
      data-incomplete={props.loading ? 'true' : undefined}
    >
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename path={filename()} />
        </CodeBlockTitle>
        <CodeBlockActions>
          <Show when={highlighted()?.error}>
            <IconButton size="compact" onClick={() => refetch()} label="Retry syntax highlighting">
              <RefreshIcon />
            </IconButton>
          </Show>
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
      <ShikiHighlightedCodeBody
        lines={lines}
        showLineNumbers={props.lineNumbers ?? true}
        startLine={props.startLine ?? 1}
      />
    </CodeBlock>
  );
}
