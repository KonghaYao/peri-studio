import { For } from 'solid-js';
import {
  FONT_STACK_DEMOS,
  FONT_WEIGHT_DEMOS,
  RADIUS_PREVIEW_STEPS,
  RADIUS_SEMANTIC_DEMOS,
  SHELL_GEOMETRY_DEMOS,
  SPACING_GAP_DEMOS,
  SPACING_PREVIEW_STEPS,
  TYPOGRAPHY_LEADING_DEMOS,
  TYPOGRAPHY_ROLE_DEMOS,
  TYPOGRAPHY_SIZE_STEPS,
} from '@/lib/token-preview-catalog';
import { getTokenCSSValue, resolveToken } from '@/lib/token-reader';

function PreviewBlock(props: { title: string; children: unknown }) {
  return (
    <div class="mb-24">
      <div class="mb-10 text-12 font-semibold text-content-secondary">{props.title}</div>
      {props.children as never}
    </div>
  );
}

export function SpacingScalePreview() {
  return (
    <>
      <PreviewBlock title="Pixel bars">
        <div class="flex flex-col gap-8 rounded-lg border border-border-subtle bg-surface-canvas p-12">
          <For each={[...SPACING_PREVIEW_STEPS]}>
            {(step) => {
              const name = `--space-${step}`;
              return (
                <div class="grid grid-cols-1 items-center gap-8 compact:grid-cols-spacing-preview">
                  <code class="text-10 text-content-muted">{name}</code>
                  <div class="flex min-w-0 items-center gap-10">
                    <div
                      class="token-preview-spacing-bar"
                      style={{ width: `var(${name})` }}
                      title={getTokenCSSValue(name)}
                    />
                    <span class="text-10 text-content-faint">{getTokenCSSValue(name)}</span>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Gap composition">
        <div class="grid grid-cols-1 gap-12 compact:grid-cols-3">
          <For each={[...SPACING_GAP_DEMOS]}>
            {(demo) => (
              <div class="rounded-lg border border-border-subtle bg-surface-canvas p-12">
                <div class="mb-8 flex items-baseline justify-between gap-8">
                  <code class="text-10 text-content-primary">{demo.utility}</code>
                  <span class="text-10 text-content-faint">{demo.label}</span>
                </div>
                <div class={`flex ${demo.utility}`}>
                  <div class="token-preview-gap-cell" />
                  <div class="token-preview-gap-cell" />
                  <div class="token-preview-gap-cell" />
                </div>
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Padding inset">
        <div class="grid grid-cols-2 gap-12 compact:grid-cols-4">
          <For each={['p-8', 'p-16', 'p-24', 'p-32']}>
            {(utility) => (
              <div class="rounded-lg border border-border-subtle bg-surface-canvas">
                <div class="border-b border-border-faint px-10 py-6 text-10 text-content-muted">{utility}</div>
                <div class={utility}>
                  <div class="rounded-md border border-accent-border bg-accent-soft px-8 py-10 text-10 text-content-secondary">
                    Content
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>
    </>
  );
}

export function RadiusScalePreview() {
  return (
    <>
      <PreviewBlock title="Radius scale">
        <div class="flex flex-wrap items-end gap-16">
          <For each={[...RADIUS_PREVIEW_STEPS]}>
            {(entry) => (
              <div class="flex w-72 flex-col items-center gap-8">
                <div
                  class="token-preview-radius-tile"
                  style={{ 'border-radius': `var(${entry.name})` }}
                />
                <code class="text-10 text-content-muted">{entry.label}</code>
                <span class="text-9 text-content-faint">{resolveToken(entry.name, 'border-radius')}</span>
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Semantic aliases">
        <div class="grid grid-cols-1 gap-12 compact:grid-cols-3">
          <For each={[...RADIUS_SEMANTIC_DEMOS]}>
            {(entry) => (
              <div class="rounded-lg border border-border-subtle bg-surface-canvas p-12">
                <div class="mb-8 flex items-baseline justify-between gap-8">
                  <code class="text-10 text-content-primary">{entry.name}</code>
                  <span class="text-10 text-content-faint">{entry.hint}</span>
                </div>
                <div
                  class="token-preview-radius-semantic"
                  style={{ 'border-radius': `var(${entry.name})` }}
                >
                  {entry.label}
                </div>
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>
    </>
  );
}

export function TypographyScalePreview() {
  return (
    <>
      <PreviewBlock title="Semantic roles">
        <div class="grid grid-cols-1 gap-12 compact:grid-cols-2">
          <For each={[...TYPOGRAPHY_ROLE_DEMOS]}>
            {(role) => (
              <div class="rounded-lg border border-border-subtle bg-surface-canvas p-14">
                <div class="mb-8 flex items-baseline justify-between gap-8">
                  <span class="text-11 font-medium text-content-secondary">{role.label}</span>
                  <code class="text-10 text-content-faint">{role.name}</code>
                </div>
                <div class={`${role.utility} text-content-primary`}>{role.sample}</div>
                <div class="mt-8 text-10 text-content-faint">
                  {resolveToken(role.name, 'font-size')} · utility <code>{role.utility}</code>
                </div>
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Size scale">
        <div class="overflow-hidden rounded-lg border border-border-subtle">
          <For each={[...TYPOGRAPHY_SIZE_STEPS]}>
            {(name, index) => (
              <div
                class="grid grid-cols-1 items-baseline gap-8 px-14 py-10 compact:grid-cols-typography-preview"
                classList={{ 'border-t border-border-subtle': index() > 0 }}
              >
                <code class="text-10 text-content-muted">{name}</code>
                <span class="text-content-primary" style={{ 'font-size': `var(${name})`, 'line-height': '1.2' }}>
                  The quick brown fox · 敏捷的棕色狐狸
                </span>
                <span class="text-10 text-content-faint">{resolveToken(name, 'font-size')}</span>
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Font stacks">
        <div class="grid grid-cols-1 gap-12">
          <For each={[...FONT_STACK_DEMOS]}>
            {(font) => (
              <div class="rounded-lg border border-border-subtle bg-surface-canvas p-14">
                <div class="mb-8 flex items-baseline justify-between gap-8">
                  <span class="text-11 font-medium text-content-secondary">{font.label}</span>
                  <code class="text-10 text-content-faint">{font.name}</code>
                </div>
                <div class="text-body text-content-primary" style={{ 'font-family': `var(${font.name})` }}>
                  {font.sample}
                </div>
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Font weights">
        <div class="grid grid-cols-1 gap-10 compact:grid-cols-2">
          <For each={[...FONT_WEIGHT_DEMOS]}>
            {(weight) => (
              <div class="rounded-lg border border-border-subtle px-14 py-10">
                <div class="text-14 text-content-primary" style={{ 'font-weight': weight }}>
                  {weight} — Interface text sample
                </div>
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Leading roles">
        <div class="grid grid-cols-1 gap-12 compact:grid-cols-2">
          <For each={[...TYPOGRAPHY_LEADING_DEMOS]}>
            {(leading) => (
              <div class="rounded-lg border border-border-subtle bg-surface-canvas p-14">
                <div class="mb-8 flex items-baseline justify-between gap-8">
                  <code class="text-10 text-content-muted">{leading.name}</code>
                  <span class="text-10 text-content-faint">{resolveToken(leading.name, 'line-height')}</span>
                </div>
                <p class="text-body text-content-primary" style={{ 'line-height': `var(${leading.name})` }}>
                  {leading.sample}
                </p>
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>
    </>
  );
}

export function ShellChromePreview() {
  return (
    <>
      <PreviewBlock title="Layout wireframe">
        <div class="token-preview-shell-frame" aria-hidden="true">
          <div class="token-preview-shell-header">
            <span>Header</span>
            <code>--sandbox-header-height</code>
          </div>
          <div class="token-preview-shell-body">
            <div class="token-preview-shell-sidebar">
              <span>Sidebar</span>
              <code>--shell-sidebar-width</code>
            </div>
            <div class="token-preview-shell-content">
              <span>Content</span>
              <code>scroll-margin: --sandbox-scroll-anchor</code>
            </div>
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Resolved geometry">
        <div class="grid grid-cols-1 gap-10 compact:grid-cols-2">
          <For each={[...SHELL_GEOMETRY_DEMOS]}>
            {(token) => (
              <div class="rounded-lg border border-border-subtle bg-surface-canvas px-14 py-12">
                <div class="text-11 font-medium text-content-primary">{token.label}</div>
                <code class="text-10 text-content-muted">{token.name}</code>
                <div class="mt-8 font-mono text-12 text-content-secondary">
                  {resolveToken(token.name, token.role)}
                </div>
                <div
                  class="token-preview-shell-meter"
                  classList={{ 'token-preview-shell-meter--height': token.role === 'height', 'token-preview-shell-meter--width': token.role === 'width' }}
                  style={token.role === 'height' ? { height: `var(${token.name})` } : { width: `var(${token.name})` }}
                />
              </div>
            )}
          </For>
        </div>
      </PreviewBlock>
    </>
  );
}

export function ElevationPreview(props: { names: string[] }) {
  return (
    <div class="flex flex-wrap gap-16">
      <For each={props.names}>
        {(name) => (
          <div class="flex w-180 flex-col gap-8">
            <div
              class="token-preview-shadow-tile"
              style={{ 'box-shadow': `var(${name})` }}
            >
              {name.replace('--shadow-', '')}
            </div>
            <code class="text-center text-10 text-content-faint">{name}</code>
          </div>
        )}
      </For>
    </div>
  );
}
