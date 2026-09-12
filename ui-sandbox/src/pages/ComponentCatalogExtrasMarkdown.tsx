import { Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import { Markdown } from '@/components/blocks';
import { MARKDOWN_LAB_SAMPLE } from '@/fixtures/markdown-lab-sample';
import { MERMAID_LAB_MARKDOWN } from '@/fixtures/mermaid-lab-sample';
import { createStreamingReveal, StreamingControls } from '@/lib/streaming-demo';
import { ComponentCatalogExtrasCode } from '@/pages/ComponentCatalogExtrasCode';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

function MarkdownFrame(props: { children: unknown }) {
  return (
    <div class="chat-column max-w-(--chat-content-max) rounded-lg border border-border-subtle bg-surface-overlay px-16 py-16">
      {props.children as never}
    </div>
  );
}

function MermaidRenderDemo() {
  const reveal = createStreamingReveal(MERMAID_LAB_MARKDOWN);

  return (
    <div class="flex flex-col gap-16">
      <DemoRow label="Complete">
        <div class="w-full min-w-0">
          <MarkdownFrame>
            <Markdown source={MERMAID_LAB_MARKDOWN} />
          </MarkdownFrame>
        </div>
      </DemoRow>
      <DemoRow label="Streaming">
        <div class="flex w-full min-w-0 flex-col gap-16">
          <StreamingControls
            playing={reveal.playing()}
            complete={reveal.complete()}
            onPlay={() => reveal.play('normal')}
            onPlayFast={() => reveal.play('fast')}
            onReset={reveal.reset}
            playLabel="Stream"
            fastPlayLabel="Fast stream"
          />
          <MarkdownFrame>
            <Markdown source={reveal.text} streaming={reveal.streaming()} />
          </MarkdownFrame>
        </div>
      </DemoRow>
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
        onPlay={() => reveal.play('normal')}
        onPlayFast={() => reveal.play('fast')}
        onReset={reveal.reset}
        playLabel="Stream"
        fastPlayLabel="Fast stream"
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

      <Show when={showCatalogSection(props.sections, 'markdown-mermaid')}>
        <CatalogDemo
          id="markdown-mermaid"
          title="Mermaid"
          description="Subgraphs, class styling, sequence autonumber, and state machines. Streaming reveals incomplete fences with worker prefix parsing."
        >
          <MermaidRenderDemo />
        </CatalogDemo>
      </Show>

      <ComponentCatalogExtrasCode sections={props.sections} />
    </>
  );
}
