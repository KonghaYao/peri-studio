import { createResource, Show } from 'solid-js';
import { IconButton } from '@/lib/catalog-ui';
import { memoizeAsync } from '@peri/ui';
import { RefreshCw } from 'lucide-solid';

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

const loadMathCached = memoizeAsync(
  (expression: string, displayMode: boolean) => `${displayMode ? 'block' : 'inline'}\u0000${expression}`,
  loadMath,
);

async function typeset(expression: string, displayMode: boolean) {
  try {
    return await loadMathCached(expression, displayMode);
  } catch {
    return { html: '', error: true };
  }
}

export function MathExpression(props: { expression: string; block?: boolean }) {
  const [result, { refetch }] = createResource(
    () => [props.expression, props.block === true] as const,
    ([expression, block]) => typeset(expression, block),
  );
  const className = () =>
    props.block
      ? 'md-math md-math--block my-16 overflow-x-auto py-8 text-center'
      : 'md-math md-math--inline';

  return (
    <span class={className()} aria-label={props.expression}>
      <Show when={result()?.html} fallback={<code class="md-math__source font-mono text-12">{props.expression}</code>}>
        {(value) => <span innerHTML={value()} />}
      </Show>
      <Show when={result()?.error}>
        <IconButton size="sm" class="ml-4" onClick={() => refetch()} label="Retry math rendering">
          <RefreshCw size={13} />
        </IconButton>
      </Show>
    </span>
  );
}
