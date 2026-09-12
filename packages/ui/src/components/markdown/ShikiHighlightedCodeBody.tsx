import { For, Show, type JSX } from 'solid-js';
import { CodeBlockBody } from '../CodeBlock';

type HighlightToken = { content: string; color?: string; fontStyle?: number };

function tokenStyle(token: HighlightToken) {
  return {
    color: token.color,
    'font-style': token.fontStyle && token.fontStyle & 1 ? 'italic' : undefined,
    'font-weight': token.fontStyle && token.fontStyle & 2 ? '600' : undefined,
    'text-decoration': token.fontStyle && token.fontStyle & 4 ? 'underline' : undefined,
  } as JSX.CSSProperties;
}

type ShikiHighlightedCodeBodyProps = {
  lines: () => HighlightToken[][];
  showLineNumbers?: boolean;
  startLine?: number;
};

export function ShikiHighlightedCodeBody(props: ShikiHighlightedCodeBodyProps) {
  const startLine = () => props.startLine ?? 1;

  return (
    <div class="relative overflow-auto">
      <CodeBlockBody
        showLineNumbers={props.showLineNumbers}
        startLine={props.startLine}
        class="max-h-520"
      >
        <For each={props.lines()}>
          {(line, index) => (
            <span
              class={`md-code-line grid min-h-18 px-14 ${props.showLineNumbers ? 'grid-cols-code-line' : 'grid-cols-1'}`}
            >
              <Show when={props.showLineNumbers}>
                <span
                  class="md-code-line__number mr-14 min-w-20 select-none text-right text-content-faint"
                  data-testid="md-code-line-number"
                  aria-hidden="true"
                >
                  {startLine() + index()}
                </span>
              </Show>
              <span class="whitespace-pre">
                <For each={line}>
                  {(token) => <span style={tokenStyle(token)}>{token.content}</span>}
                </For>
                {index() < props.lines().length - 1 ? '\n' : ''}
              </span>
            </span>
          )}
        </For>
      </CodeBlockBody>
    </div>
  );
}
