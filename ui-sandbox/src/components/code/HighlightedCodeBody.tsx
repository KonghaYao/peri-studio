import { createMemo, For, onMount, Show } from 'solid-js';
import { CodeBlockBody, useCodeBlock } from '@peri/ui';
import {
  ensureHighlightTheme,
  highlightCode,
  normalizeLanguage,
  tokensByLine,
} from '@/lib/code-highlight';

type HighlightedCodeBodyProps = {
  language: string;
  showLineNumbers?: boolean;
  startLine?: number;
  class?: string;
};

/** TanStack Highlight 语法高亮 body；由 sandbox CodeBlock 默认注入。 */
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
    <CodeBlockBody
      showLineNumbers={props.showLineNumbers}
      startLine={props.startLine}
      class={`code-block-highlight ${props.class ?? ''}`}
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
  );
}
