import { createEffect, createSignal, createUniqueId, Show } from 'solid-js';
import { CodeIcon, CopyButton, Dialog, DialogContent, DialogHeader, DialogTitle, DownloadIcon, ExpandIcon, IconButton, RefreshIcon } from '@/shared/ui';
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
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, suppressErrorRendering: true });
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

  return <div class="md-mermaid" data-incomplete={props.incomplete ? 'true' : undefined}>
    <div class="md-code-toolbar flex min-h-38 items-center gap-4 border-b border-divider px-8 py-5">
      <span class="mr-auto text-12 font-600 text-text-secondary">Mermaid</span>
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
    <Show when={showSource()}><pre class="m-0 max-h-360 overflow-auto bg-sidebar-bg px-14 py-13 text-12p5 leading-18"><code class="bg-transparent p-0 text-inherit">{props.code}</code></pre></Show>
    <Show when={error()}><div role="alert" class="border-t border-divider px-14 py-10 text-12 text-danger">{error()}</div></Show>
    <Show when={!showSource() && svg()}>{(value) => <div class="md-mermaid__result bg-surface p-16">
      <div class="overflow-auto [&_svg]:mx-auto [&_svg]:max-w-full" innerHTML={value()} />
      <Dialog open={expanded()} onOpenChange={setExpanded}><DialogContent class="w-[min(920px,calc(100vw-40px))] max-h-[calc(100dvh-40px)]">
        <DialogHeader><DialogTitle>Diagram</DialogTitle></DialogHeader>
        <div class="max-h-[calc(100dvh-110px)] overflow-auto border-t border-divider bg-surface p-20 [&_svg]:mx-auto [&_svg]:max-w-full" innerHTML={value()} />
      </DialogContent></Dialog>
    </div>}</Show>
  </div>;
}
