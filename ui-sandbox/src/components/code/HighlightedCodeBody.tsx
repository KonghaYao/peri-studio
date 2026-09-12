import { createResource, For, Show, type JSX } from 'solid-js';
import { CodeBlockBody, useCodeBlock } from '@peri/ui';
import { highlightCode, normalizeLanguage } from '@/lib/code-highlight';

function tokenStyle(token: { content: string; color?: string; fontStyle?: number }) {
  return {
    color: token.color,
    'font-style': token.fontStyle && token.fontStyle & 1 ? 'italic' : undefined,
    'font-weight': token.fontStyle && token.fontStyle & 2 ? '600' : undefined,
    'text-decoration': token.fontStyle && token.fontStyle & 4 ? 'underline' : undefined,
  } as JSX.CSSProperties;
}

type HighlightedCodeBodyProps = {
  language: string;
  showLineNumbers?: boolean;
  startLine?: number;
  class?: string;
};

/** Shiki 语法高亮 body，须在 CodeBlock 内与 includeDefaultBody={false} 组合使用。 */
export function HighlightedCodeBody(props: HighlightedCodeBodyProps) {
  const { code } = useCodeBlock();
  const [highlighted] = createResource(
    () => [code(), normalizeLanguage(props.language)] as const,
    ([source, language]) => highlightCode(source, language),
  );

  const lines = () =>
    highlighted()?.tokens
    ?? code().split('\n').map((line) => [{ content: line }]);
  const startLine = () => props.startLine ?? 1;

  return (
    <CodeBlockBody
      showLineNumbers={props.showLineNumbers}
      startLine={props.startLine}
      class={props.class}
    >
      <For each={lines()}>
        {(line, index) => (
          <span
            class={`grid min-h-18 px-14 ${props.showLineNumbers ? 'grid-cols-code-line' : 'grid-cols-1'}`}
          >
            <Show when={props.showLineNumbers}>
              <span
                class="mr-14 min-w-20 select-none text-right text-content-faint"
                aria-hidden="true"
              >
                {startLine() + index()}
              </span>
            </Show>
            <span class="whitespace-pre">
              <For each={line}>
                {(token) => <span style={tokenStyle(token)}>{token.content}</span>}
              </For>
              {index() < lines().length - 1 ? '\n' : ''}
            </span>
          </span>
        )}
      </For>
    </CodeBlockBody>
  );
}
