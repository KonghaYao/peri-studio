import { createEffect, createSignal, createUniqueId, onCleanup, Show } from 'solid-js';
import { findPrefixOffthread, getMermaid, toSafeMermaidSvgMarkup } from '@peri/markdown';
import { downloadText } from '../../lib/download';
import { IconButton } from '../Button';
import { CopyButton } from '../CopyButton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../Dialog';
import { CodeIcon, DownloadIcon, ExpandIcon, RefreshIcon } from '../Icon';

function normalizeMermaidSource(value: string) {
  return value
    .replace(/\]::([^:])/g, ']:::$1')
    .replace(/:::subgraphNode$/gm, '::subgraphNode');
}

export function MermaidBlock(props: { code: string; incomplete?: boolean; isDark?: boolean }) {
  const id = `peri-mermaid-${createUniqueId().replace(/[^a-z0-9_-]/gi, '')}`;
  const [svg, setSvg] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [sourceVisible, setSourceVisible] = createSignal(false);
  let renderVersion = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const showSource = () => !!props.incomplete || sourceVisible();
  const theme = () => (props.isDark ? 'dark' : 'light');

  const scheduleRender = (delay = 0) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void renderDiagram(), delay);
  };

  const renderDiagram = async () => {
    const code = normalizeMermaidSource(props.code);
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
      if (props.incomplete) {
        const prefix = await findPrefixOffthread(code, theme()).catch(() => null);
        if (prefix) renderSource = prefix;
      }

      const mermaid = await getMermaid();
      if (!mermaid) throw new Error('Mermaid is not available');
      const result = await mermaid.render(id, renderSource);
      const rawSvg = typeof result === 'string' ? result : result.svg ?? '';
      const safeSvg = toSafeMermaidSvgMarkup(rawSvg) || '';
      if (version === renderVersion) setSvg(safeSvg);
    } catch (reason) {
      if (version === renderVersion && !props.incomplete) {
        setError(reason instanceof Error ? reason.message : 'Diagram could not be rendered');
      }
    } finally {
      if (version === renderVersion) setBusy(false);
    }
  };

  createEffect(() => {
    props.code;
    scheduleRender(props.incomplete ? 300 : 0);
  });

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  return (
    <div class="md-mermaid" data-testid="md-mermaid" data-incomplete={props.incomplete ? 'true' : undefined}>
      <div class="md-code-toolbar flex min-h-36 items-center gap-4 border-b border-border-subtle px-8 py-4">
        <span class="mr-auto text-12 font-medium text-content-secondary">Mermaid</span>
        <Show when={busy()}><span class="ui-spinner mx-8" aria-hidden="true" /><span class="sr-only">Rendering diagram</span></Show>
        <Show when={!props.incomplete}>
          <IconButton size="compact" onClick={() => setSourceVisible((visible) => !visible)} label={showSource() ? 'Show diagram' : 'Show source'} aria-pressed={sourceVisible()}><CodeIcon /></IconButton>
        </Show>
        <Show when={error()}><IconButton size="compact" onClick={() => renderDiagram()} busy={busy()} label="Retry rendering"><RefreshIcon /></IconButton></Show>
        <CopyButton text={showSource() ? props.code : svg()} label={showSource() ? 'Copy code' : 'Copy SVG'} size="compact" disabled={props.incomplete || (!showSource() && !svg())} />
        <Show when={!showSource() && svg()}>
          <IconButton size="compact" onClick={() => setExpanded(true)} label="Open diagram"><ExpandIcon /></IconButton>
          <IconButton size="compact" onClick={() => downloadText(svg(), 'diagram.svg', 'image/svg+xml')} label="Download SVG"><DownloadIcon /></IconButton>
        </Show>
      </div>
      <Show when={showSource()}><pre class="m-0 max-h-360 overflow-auto bg-surface-sunken px-12 py-10 font-mono text-12 leading-relaxed"><code class="bg-transparent p-0 text-inherit">{props.code}</code></pre></Show>
      <Show when={error()}><div role="alert" class="border-t border-border-subtle px-12 py-8 text-12 text-danger-solid">{error()}</div></Show>
      <Show when={!showSource() && svg()}>{(value) => <div class="md-mermaid__result bg-surface-overlay p-16" data-testid="md-mermaid-result">
        <div class="md-mermaid__canvas overflow-auto" innerHTML={value()} />
        <Dialog open={expanded()} onOpenChange={setExpanded}><DialogContent class="w-(--container-mermaid) max-h-(--container-dialog-tall)">
          <DialogHeader><DialogTitle>Diagram</DialogTitle></DialogHeader>
          <div class="md-mermaid__canvas md-mermaid__canvas--dialog max-h-(--container-mermaid-body) overflow-auto border-t border-border-subtle bg-surface-overlay p-20" innerHTML={value()} />
        </DialogContent></Dialog>
      </div>}</Show>
    </div>
  );
}
