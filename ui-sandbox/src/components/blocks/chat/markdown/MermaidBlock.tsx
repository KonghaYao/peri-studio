import { createEffect, createSignal, createUniqueId, Show } from 'solid-js';
import { Code2, Download, Expand, RefreshCw } from 'lucide-solid';
import { CopyButton, Dialog, IconButton } from '@/components/ui';
import { downloadText } from './download';

function sanitizeSvg(source: string) {
  const documentNode = new DOMParser().parseFromString(source, 'image/svg+xml');
  documentNode.querySelectorAll('script, foreignObject, iframe, object, embed, image').forEach((node) => node.remove());
  documentNode.querySelectorAll('style').forEach((node) => {
    if (/@import|url\(\s*['"]?(?:https?:|data:|javascript:)/i.test(node.textContent || '')) node.remove();
  });
  documentNode.querySelectorAll('*').forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      const externalReference = (name === 'href' || name === 'xlink:href' || name === 'src') && !value.startsWith('#');
      const externalStyle = name === 'style' && /url\(\s*['"]?(?!#)/i.test(value);
      if (name.startsWith('on') || externalReference || externalStyle) node.removeAttribute(attribute.name);
    }
  });
  return new XMLSerializer().serializeToString(documentNode.documentElement);
}

export function MermaidBlock(props: { code: string; incomplete?: boolean }) {
  const id = `peri-mermaid-${createUniqueId().replace(/[^a-z0-9_-]/gi, '')}`;
  const [svg, setSvg] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [sourceVisible, setSourceVisible] = createSignal(false);
  let renderVersion = 0;
  const showSource = () => !!props.incomplete || sourceVisible();

  const renderDiagram = async (code = props.code) => {
    const version = ++renderVersion;
    setBusy(true);
    setError('');
    try {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        htmlLabels: false,
        suppressErrorRendering: true,
      });
      const result = await mermaid.render(id, code);
      if (version === renderVersion) setSvg(sanitizeSvg(result.svg));
    } catch (reason) {
      if (version === renderVersion) setError(reason instanceof Error ? reason.message : 'Diagram could not be rendered');
    } finally {
      if (version === renderVersion) setBusy(false);
    }
  };

  createEffect(() => {
    const code = props.code;
    if (!props.incomplete && code.trim()) void renderDiagram(code);
  });

  return (
    <div class="md-mermaid" data-incomplete={props.incomplete ? 'true' : undefined}>
      <div class="flex min-h-8 items-center gap-1 border-b border-border-subtle px-2 py-1">
        <span class="mr-auto text-12 font-medium text-content-secondary">Mermaid</span>
        <Show when={busy()}><span class="text-11 text-content-muted">Rendering…</span></Show>
        <Show when={!props.incomplete}>
          <IconButton
            size="sm"
            label={showSource() ? 'Show diagram' : 'Show source'}
            onClick={() => setSourceVisible((visible) => !visible)}
          >
            <Code2 size={14} />
          </IconButton>
        </Show>
        <Show when={error()}>
          <IconButton size="sm" disabled={busy()} label="Retry rendering" onClick={() => renderDiagram()}>
            <RefreshCw size={14} />
          </IconButton>
        </Show>
        <CopyButton text={showSource() ? props.code : svg()} label={showSource() ? 'Copy code' : 'Copy SVG'} disabled={props.incomplete || (!showSource() && !svg())} />
        <Show when={!showSource() && svg()}>
          <IconButton size="sm" label="Open diagram" onClick={() => setExpanded(true)}><Expand size={14} /></IconButton>
          <IconButton size="sm" label="Download SVG" onClick={() => downloadText(svg(), 'diagram.svg', 'image/svg+xml')}><Download size={14} /></IconButton>
        </Show>
      </div>
      <Show when={showSource()}>
        <pre class="m-0 max-h-80 overflow-auto bg-surface-sunken px-3 py-2.5 font-mono text-12 leading-relaxed"><code>{props.code}</code></pre>
      </Show>
      <Show when={error()}>
        <div role="alert" class="border-t border-border-subtle px-3 py-2 text-12 text-danger-solid">{error()}</div>
      </Show>
      <Show when={!showSource() && svg()}>
        {(value) => (
          <>
            <div class="md-mermaid__result bg-surface-overlay p-4">
              <div class="md-mermaid__canvas overflow-auto" innerHTML={value()} />
            </div>
            <Dialog open={expanded()} onOpenChange={setExpanded} title="Diagram" width="var(--container-mermaid)">
              <div class="md-mermaid__canvas md-mermaid__canvas--dialog max-h-(--container-mermaid-body) overflow-auto" innerHTML={value()} />
            </Dialog>
          </>
        )}
      </Show>
    </div>
  );
}
