import { createResource, Show } from 'solid-js';
import { IconButton, RefreshIcon } from '@peri/ui';
import { memoizeAsync } from '@peri/ui';

async function loadMath(expression: string, displayMode: boolean) {
  const [{ default: katex }] = await Promise.all([
    import('katex'),
    import('katex/dist/katex.min.css'),
  ]);
  return {
    html: katex.renderToString(expression, {
      displayMode,
      output: 'htmlAndMathml',
      strict: 'warn',
      throwOnError: false,
      trust: false,
    }),
    error: false,
  };
}

const loadMathCached = memoizeAsync((expression: string, displayMode: boolean) => `${displayMode ? 'block' : 'inline'}\u0000${expression}`, loadMath);

async function typeset(expression: string, displayMode: boolean) {
  try {
    return await loadMathCached(expression, displayMode);
  } catch {
    return { html: '', error: true };
  }
}

export function MathExpression(props: { expression: string; block?: boolean }) {
  const [result, { refetch }] = createResource(() => [props.expression, props.block === true] as const, ([expression, block]) => typeset(expression, block));
  const className = () => `md-math ${props.block ? 'md-math--block my-(--markdown-rich-block-gap) overflow-x-auto py-6 text-center' : 'md-math--inline'}`;
  return <span class={className()} data-testid={props.block ? 'md-math-block' : 'md-math-inline'} aria-label={props.expression}>
    <Show when={result()?.html} fallback={<code class="md-math__source">{props.expression}</code>}>
      {(value) => <span innerHTML={value()} />}
    </Show>
    <Show when={result()?.error}><IconButton size="compact" class="ml-6" onClick={() => refetch()} label="Retry math rendering"><RefreshIcon /></IconButton></Show>
  </span>;
}
