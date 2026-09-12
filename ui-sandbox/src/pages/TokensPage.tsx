import { For, Show, createMemo } from 'solid-js';
import { groupTokens, readDesignTokens, resolveToken, type TokenEntry } from '@/lib/token-reader';
import { TierHeader } from '@/pages/shared/DemoSection';

/* Tier 1 · Design tokens：运行时读取 tokens.css，看板与实现一致。 */

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
      {/* 固定高度的 note 行：有无注释都保持 chips 等高 */}
      <div class="truncate text-9 leading-normal text-content-faint">{props.note ?? '\u00A0'}</div>
    </div>
  );
}

/* 锚点档（现行生产色来源）在 chips 上以 accent 色档位名标注 */
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

function SemanticTable(props: { entries: TokenEntry[]; prefix: string; label: string }) {
  const rows = createMemo(() => groupTokens(props.entries, props.prefix));
  return (
    <Show when={rows().length > 0}>
      <div class="mb-24">
        <div class="mb-8 text-12 font-semibold text-content-secondary">{props.label}</div>
        <div class="overflow-hidden rounded-lg border border-border-subtle">
          <For each={rows()}>
            {(entry, index) => (
              <div
                class="grid grid-cols-1 items-center gap-4 px-12 py-8 text-12 compact:grid-cols-token-row compact:gap-12"
                classList={{ 'border-t border-border-subtle': index() > 0 }}
              >
                <code class="truncate text-11 text-content-primary">{entry.name}</code>
                <span class="flex items-center gap-8 text-content-secondary">
                  <span class="size-16 flex-none rounded-sm border border-black/10" style={{ background: `var(${entry.name})` }} />
                  <span class="truncate font-mono text-10 text-content-muted" title={resolveToken(entry.name)}>{entry.value}</span>
                </span>
                <span class="truncate font-mono text-10 text-content-faint max-compact:pl-24">{resolveToken(entry.name)}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

export function TokensPage() {
  const entries = createMemo(() => readDesignTokens());

  const spacingSteps = createMemo(() =>
    groupTokens(entries(), '--space-')
      .filter((entry) => /^--space-\d+$/.test(entry.name))
      .sort((left, right) => Number(left.name.replace('--space-', '')) - Number(right.name.replace('--space-', ''))),
  );
  const radii = createMemo(() => groupTokens(entries(), '--radius-').filter((entry) => !['control', 'card', 'pill'].some((alias) => entry.name.endsWith(alias))));
  const textSizes = createMemo(() => groupTokens(entries(), '--text-').filter((entry) => /-\d+$/.test(entry.name)));
  const textAliases = createMemo(() => entries().filter((entry) => /^--text-(caption|body|title|display)$/.test(entry.name)));
  const leadings = createMemo(() => groupTokens(entries(), '--leading-'));
  const shadows = createMemo(() => groupTokens(entries(), '--shadow-'));
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
        description="palette → semantic → component 三层。本页数值运行时读取 tokens.css，与实现同步。"
      />

      <Section id="palette" title="Tier 0 · Color palettes" description="原始色板。组件禁止直接引用；只被语义层引用。accent 命名与色相解耦。">
        <PaletteGroup family="accent" label="Accent · 湛蓝" entries={entries()} />
        <PaletteGroup family="neutral" label="Neutral · 冷灰" entries={entries()} />
        <PaletteGroup family="success" label="Success · 绿" entries={entries()} />
        <PaletteGroup family="warning" label="Warning · 琥珀" entries={entries()} />
        <PaletteGroup family="danger" label="Danger · 红" entries={entries()} />
      </Section>

      <Section id="semantic" title="Tier 1 · Semantic colors" description="功能样式唯一可用层。声明值展示 var() 引用链，右侧为解析结果。深色主题只需重映射本层。">
        <SemanticTable entries={entries()} prefix="--surface-" label="表面" />
        <SemanticTable entries={entries()} prefix="--content-" label="文字" />
        <SemanticTable entries={entries()} prefix="--border-" label="边框" />
        <SemanticTable entries={entries()} prefix="--accent-" label="主色" />
        <SemanticTable entries={entries()} prefix="--selection-" label="选中态（边框表选中，无彩色底色）" />
        <SemanticTable entries={entries()} prefix="--interaction-" label="交互" />
        <SemanticTable entries={entries()} prefix="--feedback-" label="反馈色矩阵（solid / strong / soft / border）" />
      </Section>

      <Section id="spacing" title="Spacing · pixel scale" description="Tailwind spacing utility 数字即像素（p-8 = 8px、gap-16 = 16px）。档位来自 tokens.css 的 --space-*，由 theme.css 映射为 p-* / gap-* / m-* 等。">
        <div class="flex flex-col gap-6">
          <For each={spacingSteps()}>
            {(entry) => (
              <div class="flex items-center gap-12">
                <code class="w-64 flex-none text-right text-10 text-content-muted">{entry.name} = {entry.value}</code>
                <div class="h-12 rounded-xs bg-accent-solid/80" style={{ width: `var(${entry.name})` }} />
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section id="radius" title="Radius" description="控件圆角：control = 6px、card = 8px。语义别名 --radius-control / --radius-card / --radius-pill。">
        <div class="flex flex-wrap items-end gap-16">
          <For each={radii()}>
            {(entry) => (
              <div class="flex flex-col items-center gap-6">
                <div class="size-48 border-2 border-accent-solid bg-accent-soft" style={{ 'border-radius': `var(${entry.name})` }} />
                <code class="text-9 text-content-muted">{entry.name.replace('--radius-', '')}</code>
                <span class="text-9 text-content-faint">{entry.value}</span>
              </div>
            )}
          </For>
        </div>
      </Section>

      <Section id="typography" title="Typography" description="正文 14px（`--text-body` / `text-13`）；字重只用 400/500/600/700 标准档；行高统一无单位比例。">
        <div class="mb-24 overflow-hidden rounded-lg border border-border-subtle">
          <For each={textSizes()}>
            {(entry, index) => (
              <div class="flex items-baseline gap-16 px-12 py-8" classList={{ 'border-t border-border-subtle': index() > 0 }}>
                <code class="w-64 flex-none text-10 text-content-muted">{entry.name}</code>
                <span class="text-content-primary" style={{ 'font-size': `var(${entry.name})` }}>The quick brown fox</span>
                <span class="ml-auto text-10 text-content-faint">{entry.value}</span>
              </div>
            )}
          </For>
        </div>
        <div class="mb-24 flex flex-wrap items-baseline gap-24">
          <For each={textAliases()}>
            {(entry) => (
              <div>
                <code class="text-10 text-content-muted">{entry.name}</code>
                <div class="text-content-primary" style={{ 'font-size': `var(${entry.name})`, 'line-height': '1.2' }}>敏捷的棕色狐狸</div>
              </div>
            )}
          </For>
        </div>
        <div class="flex flex-wrap gap-32">
          <div>
            <div class="mb-4 text-11 font-semibold text-content-secondary">Weight</div>
            <For each={[400, 500, 600, 700]}>
              {(weight) => <div class="text-14 text-content-primary" style={{ 'font-weight': weight }}>{weight} — Interface text</div>}
            </For>
          </div>
          <div>
            <div class="mb-4 text-11 font-semibold text-content-secondary">Leading</div>
            <For each={leadings()}>
              {(entry) => (
                <div class="text-12 text-content-primary">
                  <code class="mr-8 text-10 text-content-muted">{entry.name.replace('--leading-', '')}</code>{entry.value}
                </div>
              )}
            </For>
          </div>
        </div>
      </Section>

      <Section id="elevation" title="Elevation & motion" description="能不用阴影就不用；浮层离开画布时才使用 overlay 阴影。">
        <div class="flex flex-wrap gap-16">
          <For each={shadows()}>
            {(entry) => (
              <div class="flex w-180 flex-col gap-8">
                <div class="grid h-64 place-items-center rounded-lg border border-border-subtle bg-surface-overlay text-11 text-content-muted" style={{ 'box-shadow': `var(${entry.name})` }}>
                  {entry.name.replace('--shadow-', '')}
                </div>
              </div>
            )}
          </For>
        </div>
        <div class="mt-16 flex flex-wrap gap-24 text-12 text-content-secondary">
          <span>duration <code class="text-11">--duration-fast 120ms · --duration-base 160ms</code></span>
          <span>z-index <code class="text-11">sticky 10 · overlay 40 · modal 50 · toast 60</code></span>
        </div>
      </Section>

      <Section id="component-tokens" title="Tier 2 · Component tokens" description="按业务域分组；大重构可逐域推进。">
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
