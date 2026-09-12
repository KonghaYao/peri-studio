import { Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import { Markdown } from '@/components/blocks';
import { MARKDOWN_LAB_SAMPLE } from '@/fixtures/markdown-lab-sample';
import { createStreamingReveal, StreamingControls } from '@/lib/streaming-demo';
import { ComponentCatalogExtrasCode } from '@/pages/ComponentCatalogExtrasCode';
import { CatalogDemo } from '@/pages/shared/DemoSection';

function MarkdownFrame(props: { children: unknown }) {
  return (
    <div class="chat-column max-w-(--chat-content-max) rounded-lg border border-border-subtle bg-surface-overlay px-16 py-16">
      {props.children as never}
    </div>
  );
}

function MarkdownRenderDemo() {
  const reveal = createStreamingReveal(MARKDOWN_LAB_SAMPLE);

  return (
    <div class="flex flex-col gap-16">
      <StreamingControls
        playing={reveal.playing()}
        complete={reveal.complete()}
        onPlay={reveal.play}
        onReset={reveal.reset}
        playLabel="Stream"
      />
      <MarkdownFrame>
        <Markdown source={reveal.text} streaming={reveal.streaming()} />
      </MarkdownFrame>
    </div>
  );
}

export function ComponentCatalogExtrasMarkdown(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'markdown-render')}>
      <CatalogDemo id="markdown-render" title="Render">
        <MarkdownRenderDemo />
      </CatalogDemo>
      </Show>

      <ComponentCatalogExtrasCode sections={props.sections} />
    </>
  );
}
