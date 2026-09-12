import { createMemo, For, onMount, Show } from 'solid-js';
import {
  ensureHighlightTheme,
  highlightCode,
  normalizeLanguage,
  tokensByLine,
} from '../lib/code-highlight';
import { CodeBlockBody, useCodeBlock } from './CodeBlock';

type HighlightedCodeBodyProps = {
  language: string;
  showLineNumbers?: boolean;
  startLine?: number;
  class?: string;
};

/** TanStack Highlight 语法高亮 body；须在 CodeBlock 子树内渲染。 */
export function HighlightedCodeBody(props: HighlightedCodeBodyProps) {
  const { code } = useCodeBlock();

  onMount(() => {
    ensureHighlightTheme();
  });

  const lines = createMemo(() => {
    const result = highlightCode(code(), normalizeLanguage(props.language));
    return tokensByLine(result.tokens);
  });
  const startLine = () => props.startLine ?? 1;

  return (
    <div class="relative overflow-auto">
      <CodeBlockBody
        showLineNumbers={props.showLineNumbers}
        startLine={props.startLine}
        class={`code-block-highlight max-h-520 ${props.class ?? ''}`}
      >
        <For each={lines()}>
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
                  {(token) => (
                    <Show when={token.className} fallback={<span>{token.value}</span>}>
                      <span class={`th-${token.className}`}>{token.value}</span>
                    </Show>
                  )}
                </For>
                {index() < lines().length - 1 ? '\n' : ''}
              </span>
            </span>
          )}
        </For>
      </CodeBlockBody>
    </div>
  );
}
