import { createResource, Show } from 'solid-js';

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

export function MathExpression(props: { expression: string; block?: boolean }) {
  const [result, { refetch }] = createResource(
    () => [props.expression, props.block === true] as const,
    ([expression, block]) => loadMath(expression, block),
  );
  const className = () => `md-math ${props.block ? 'md-math--block my-(--markdown-rich-block-gap) overflow-x-auto py-6 text-center' : 'md-math--inline'}`;

  return (
    <span class={className()} data-testid={props.block ? 'md-math-block' : 'md-math-inline'} aria-label={props.expression}>
      <Show when={result()?.html} fallback={<code class="md-math__source">{props.expression}</code>}>
        {(value) => <span innerHTML={value()} />}
      </Show>
      <Show when={result()?.error}>
        <button type="button" class="ml-6 text-12 text-content-muted" onClick={() => refetch()}>Retry</button>
      </Show>
    </span>
  );
}
