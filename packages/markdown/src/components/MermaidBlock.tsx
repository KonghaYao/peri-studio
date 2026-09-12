import { createEffect, createSignal, createUniqueId, onCleanup, Show } from 'solid-js';
import { toSafeMermaidSvgMarkup } from 'stream-markdown-parser';
import { getMermaid } from '../optional/mermaid';
import { findPrefixOffthread } from '../workers/mermaidWorkerClient';

function normalizeMermaidSource(value: string) {
  return value
    .replace(/\]::([^:])/g, ']:::$1')
    .replace(/:::subgraphNode$/gm, '::subgraphNode');
}

export function MermaidBlock(props: { code: string; loading?: boolean }) {
  const id = `peri-mermaid-${createUniqueId().replace(/[^a-z0-9_-]/gi, '')}`;
  const [svg, setSvg] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [showSource, setShowSource] = createSignal(false);
  let renderVersion = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const source = () => normalizeMermaidSource(props.code);
  const incomplete = () => props.loading === true;

  const scheduleRender = (delay = 0) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void renderDiagram(), delay);
  };

  const renderDiagram = async () => {
    const code = source();
    if (!code.trim()) {
      setSvg('');
      setError('');
      return;
    }

    const version = ++renderVersion;
    setBusy(true);
    setError('');

    try {
      let renderSource = code;
      if (incomplete()) {
        const prefix = await findPrefixOffthread(code, 'light').catch(() => null);
        if (prefix) renderSource = prefix;
      }

      const mermaid = await getMermaid();
      if (!mermaid) throw new Error('Mermaid is not available');
      const result = await mermaid.render(id, renderSource);
      const rawSvg = typeof result === 'string' ? result : result.svg ?? '';
      const safeSvg = toSafeMermaidSvgMarkup(rawSvg) || '';
      if (version === renderVersion) setSvg(safeSvg);
    } catch (reason) {
      if (version === renderVersion && !incomplete()) {
        setError(reason instanceof Error ? reason.message : 'Diagram could not be rendered');
      }
    } finally {
      if (version === renderVersion) setBusy(false);
    }
  };

  createEffect(() => {
    source();
    scheduleRender(incomplete() ? 300 : 0);
  });

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  return (
    <div class="md-mermaid my-16 overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-incomplete={incomplete() ? 'true' : undefined}>
      <div class="flex min-h-36 items-center gap-4 border-b border-border-subtle px-8 py-4">
        <span class="mr-auto text-12 font-medium text-content-secondary">Mermaid</span>
        <Show when={busy()}><span class="text-11 text-content-muted">Rendering…</span></Show>
        <Show when={!incomplete()}>
          <button type="button" class="text-12 text-content-muted" onClick={() => setShowSource((value) => !value)}>
            {showSource() ? 'Show diagram' : 'Show source'}
          </button>
        </Show>
        <Show when={error()}>
          <button type="button" class="text-12 text-content-muted" onClick={() => renderDiagram()}>Retry</button>
        </Show>
      </div>
      <Show when={showSource() || incomplete()}>
        <pre class="m-0 max-h-320 overflow-auto bg-surface-sunken px-12 py-10 font-mono text-12 leading-relaxed"><code>{props.code}</code></pre>
      </Show>
      <Show when={!showSource() && !incomplete() && svg()}>
        {(value) => <div class="md-mermaid__canvas overflow-auto bg-surface-overlay p-16" innerHTML={value()} />}
      </Show>
      <Show when={error()}>
        <div role="alert" class="border-t border-border-subtle px-12 py-8 text-12 text-danger-solid">{error()}</div>
      </Show>
    </div>
  );
}
