import { createSignal, createUniqueId, Show } from 'solid-js';
import { Button, CopyButton, Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui';
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

  const renderDiagram = async () => {
    setBusy(true);
    setError('');
    try {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', htmlLabels: false, suppressErrorRendering: true });
      const result = await mermaid.render(id, props.code);
      setSvg(sanitizeSvg(result.svg));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Diagram could not be rendered');
    } finally {
      setBusy(false);
    }
  };

  return <div class="md-mermaid" data-incomplete={props.incomplete ? 'true' : undefined}>
    <div class="md-code-toolbar flex min-h-38 items-center gap-4 border-b border-divider px-8 py-5">
      <span class="mr-auto text-12 font-600 text-text-secondary">Mermaid</span>
      <Button size="compact" onClick={renderDiagram} busy={busy()} disabled={props.incomplete} aria-label="Render diagram">{svg() ? 'Render again' : 'Render'}</Button>
      <CopyButton text={props.code} label="Copy code" size="compact" disabled={props.incomplete} />
    </div>
    <pre class="m-0 max-h-360 overflow-auto bg-sidebar-bg px-14 py-13 text-12p5 leading-18"><code class="bg-transparent p-0 text-inherit">{props.code}</code></pre>
    <Show when={error()}><div role="alert" class="border-t border-divider px-14 py-10 text-12 text-danger">{error()}</div></Show>
    <Show when={svg()}>{(value) => <div class="md-mermaid__result border-t border-divider bg-surface p-16">
      <div class="flex justify-end gap-4 pb-8">
        <CopyButton text={value()} label="Copy SVG" size="compact" />
        <Button size="compact" onClick={() => setExpanded(true)} aria-label="Open diagram">Expand</Button>
        <Button size="compact" onClick={() => downloadText(value(), 'diagram.svg', 'image/svg+xml')}>Download SVG</Button>
      </div>
      <div class="overflow-auto [&_svg]:mx-auto [&_svg]:max-w-full" innerHTML={value()} />
      <Dialog open={expanded()} onOpenChange={setExpanded}><DialogContent class="w-[min(920px,calc(100vw-40px))] max-h-[calc(100dvh-40px)]">
        <DialogHeader><DialogTitle>Diagram</DialogTitle></DialogHeader>
        <div class="max-h-[calc(100dvh-110px)] overflow-auto border-t border-divider bg-surface p-20 [&_svg]:mx-auto [&_svg]:max-w-full" innerHTML={value()} />
      </DialogContent></Dialog>
    </div>}</Show>
  </div>;
}
