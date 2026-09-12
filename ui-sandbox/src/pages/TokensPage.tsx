import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { groupTokens, readDesignTokens, resolveToken, type TokenEntry } from '@/lib/token-reader';
import { SemanticColorsPreview } from '@/pages/tokens/SemanticColorsPreview';
import {
  ElevationPreview,
  RadiusScalePreview,
  ShellChromePreview,
  SpacingScalePreview,
  TypographyScalePreview,
} from '@/pages/tokens/TokenVisualPreviews';
import { TierHeader } from '@/pages/shared/DemoSection';

/* Tier 1 · Design tokens：运行时读取 tokens.css，看板与实现一致（纯展示 demo）。 */

function Section(props: { id: string; title: string; description?: string; children: unknown }) {
  return (
    <section id={props.id} class="demo-scroll-anchor border-b border-border-subtle px-16 py-28 diff-min:px-32">
      <h2 class="text-15 font-semibold text-content-primary">{props.title}</h2>
      {props.description && <p class="mt-4 mb-20 text-12 text-content-muted">{props.description}</p>}
      <div class="mt-16">{props.children as never}</div>
    </section>
  );
}

function SwatchChip(props: { entry: TokenEntry; note?: string; anchor?: boolean }) {
  const step = () => props.entry.name.split('-').pop() ?? '';
  const resolved = () => resolveToken(props.entry.name, 'color');
  return (
    <div class="w-82">
      <div
        class="h-44 rounded-md border"
        classList={{
          'border-accent-solid ring-1 ring-accent-solid': !!props.anchor,
          'border-black/8': !props.anchor,
        }}
        style={{ background: `var(${props.entry.name})` }}
      />
      <div class="mt-6 text-11 font-medium" classList={{ 'text-accent-solid': !!props.anchor, 'text-content-primary': !props.anchor }}>{step()}</div>
      <div class="truncate font-mono text-9 leading-normal text-content-muted" title={resolved()}>{props.entry.value.startsWith('#') ? props.entry.value : resolved()}</div>
      <div class="truncate text-9 leading-normal text-content-faint">{props.note ?? '\u00A0'}</div>
    </div>
  );
}

const ANCHOR_STEPS: Record<string, string> = {
  'accent-600': 'solid 锚点',
  'success-500': 'solid 锚点',
  'warning-500': 'solid 锚点',
  'danger-500': 'solid 锚点',
};

function PaletteGroup(props: { family: string; label: string; entries: TokenEntry[] }) {
  const steps = createMemo(() => groupTokens(props.entries, `--palette-${props.family}-`));
  return (
    <div class="mb-20">
      <div class="mb-8 flex items-baseline gap-8">
        <span class="text-12 font-semibold text-content-primary">{props.label}</span>
        <code class="text-10 text-content-faint">--palette-{props.family}-*</code>
      </div>
      <div class="flex flex-wrap gap-8">
        <For each={steps()}>
          {(entry) => {
            const anchor = () => ANCHOR_STEPS[`${props.family}-${entry.name.split('-').pop()}`];
            return <SwatchChip entry={entry} note={anchor()} anchor={!!anchor()} />;
          }}
        </For>
      </div>
    </div>
  );
}

export function TokensPage() {
  const [tokenRevision, setTokenRevision] = createSignal(0);
  onMount(() => {
    requestAnimationFrame(() => setTokenRevision((value) => value + 1));
  });

  const entries = createMemo(() => {
    tokenRevision();
    return readDesignTokens();
  });

  const shadows = createMemo(() => groupTokens(entries(), '--shadow-').map((entry) => entry.name));
  const domains: { prefix: string; label: string }[] = [
    { prefix: '--shell-', label: 'Shell 壳层' },
    { prefix: '--sidebar-', label: 'Sidebar 侧栏' },
    { prefix: '--chat-', label: 'Chat 聊天' },
    { prefix: '--composer-', label: 'Composer 输入' },
    { prefix: '--resource-', label: 'Resource 资源' },
    { prefix: '--decision-', label: 'Decision 决策面' },
    { prefix: '--status-', label: 'Status 状态区' },
    { prefix: '--control-', label: 'Control 控件' },
    { prefix: '--container-', label: 'Overlay 容器' },
  ];

  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 1 · Design tokens"
        title="Design tokens"
        description="palette → semantic → component 三层。本页为纯视觉 demo，运行时读取 tokens.css 并与实现同步。"
      />

      <Section id="palette" title="Tier 0 · Color palettes" description="原始色板。组件禁止直接引用；只被语义层引用。accent 命名与色相解耦。">
        <PaletteGroup family="accent" label="Accent · 湛蓝" entries={entries()} />
        <PaletteGroup family="neutral" label="Neutral · 冷灰" entries={entries()} />
        <PaletteGroup family="success" label="Success · 绿" entries={entries()} />
        <PaletteGroup family="warning" label="Warning · 琥珀" entries={entries()} />
        <PaletteGroup family="danger" label="Danger · 红" entries={entries()} />
      </Section>

      <Section id="semantic" title="Tier 1 · Semantic colors" description="功能样式唯一可用层。以下为真实 UI 场景中的视觉对照（非变量表）。">
        <SemanticColorsPreview />
      </Section>

      <Section id="spacing" title="Spacing · pixel scale" description="Tailwind spacing 数字即像素（p-8 = 8px、gap-16 = 16px）。下方为像素条、gap 组合与 padding 示意。">
        <SpacingScalePreview />
      </Section>

      <Section id="radius" title="Radius" description="控件圆角刻度与语义别名（control / card / pill）的视觉对照。">
        <RadiusScalePreview />
      </Section>

      <Section id="typography" title="Typography" description="语义字号、刻度、字体栈、字重与行高角色的实际渲染效果。">
        <TypographyScalePreview />
      </Section>

      <Section id="shell" title="Shell & header" description="沙箱顶栏、侧栏宽度与 scroll anchor 的几何示意。">
        <ShellChromePreview />
      </Section>

      <Section id="elevation" title="Elevation & motion" description="能不用阴影就不用；浮层离开画布时才使用 overlay 阴影。">
        <ElevationPreview names={shadows().length > 0 ? shadows() : ['--shadow-raised', '--shadow-overlay', '--shadow-focus-ring']} />
        <div class="mt-16 flex flex-wrap gap-24 text-12 text-content-secondary">
          <span>duration <code class="text-11">--duration-fast 120ms · --duration-base 160ms</code></span>
          <span>z-index <code class="text-11">sticky 10 · overlay 40 · modal 50 · toast 60</code></span>
        </div>
      </Section>

      <Section id="component-tokens" title="Tier 2 · Component tokens" description="按业务域分组的声明值索引（组件域 token 一览）。">
        <For each={domains}>
          {(domain) => {
            const rows = createMemo(() => groupTokens(entries(), domain.prefix));
            return (
              <Show when={rows().length > 0}>
                <div class="mb-20">
                  <div class="mb-8 text-12 font-semibold text-content-secondary">{domain.label}</div>
                  <div class="overflow-hidden rounded-lg border border-border-subtle">
                    <For each={rows()}>
                      {(entry, index) => (
                        <div class="grid grid-cols-1 items-center gap-2 px-12 py-6 compact:grid-cols-token-alias compact:gap-12" classList={{ 'border-t border-border-subtle': index() > 0 }}>
                          <code class="truncate text-11 text-content-primary">{entry.name}</code>
                          <span class="truncate font-mono text-10 text-content-muted">{entry.value}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            );
          }}
        </For>
      </Section>
    </div>
  );
}
