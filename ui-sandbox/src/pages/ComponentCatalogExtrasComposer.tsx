import { Show } from 'solid-js';
import { SlashMenu, TokenUsageMeter } from '@peri/ui';
import { showCatalogSection } from '@/catalog/catalog-section';
import { ComposerLayout, ComposerUploadLayout } from '@/layers';
import { CatalogDemo } from '@/pages/shared/DemoSection';

export function ComponentCatalogExtrasComposer(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'composer')}>
      <CatalogDemo id="composer" title="Composer">
        <ComposerLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'composer-upload')}>
      <CatalogDemo id="composer-upload" title="Composer upload">
        <ComposerUploadLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'slash-menu')}>
      <CatalogDemo id="slash-menu" title="Slash menu">
        <div class="w-(--container-slash-menu) max-w-full">
          <SlashMenu
            activeIndex={4}
            items={[
              { name: 'goal', description: 'Set a goal that the agent will pursue to completion' },
              { name: 'summarize', description: 'Summarize this conversation' },
              { name: 'canvas', description: 'Create a document, diagram, or small website…' },
              { name: 'plan', description: 'Generate an implementation plan', variant: 'plan', accent: true, dividerAfter: true },
              { name: 'compact', description: 'Compacts the current context', variant: 'plugin' },
              { name: 'automate', description: 'Trigger an agent to run based on a trigger…' },
              { name: 'code-review', description: 'Review code instead of editing it' },
              { name: 'commit', description: 'Commit the current changes' },
            ]}
          />
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'token-usage')}>
      <CatalogDemo id="token-usage" title="Token usage">
        <div
          class="flex max-w-(--composer-launch-max) flex-wrap items-center gap-16 rounded-lg border border-composer-border bg-surface-overlay px-10 py-8"
          style={{ 'border-radius': 'var(--composer-radius)' }}
        >
          <span class="text-12 text-content-muted">Green</span>
          <TokenUsageMeter input={12400} output={3180} cached={8200} limit={200000} />
          <span class="text-12 text-content-muted">Amber (~75%)</span>
          <TokenUsageMeter input={100000} output={25000} cached={20000} limit={200000} />
          <span class="text-12 text-content-muted">Red (~95%)</span>
          <TokenUsageMeter input={140000} output={32000} cached={18000} limit={200000} />
        </div>
      </CatalogDemo>
      </Show>
    </>
  );
}
