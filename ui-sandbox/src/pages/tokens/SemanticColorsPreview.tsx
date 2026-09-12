import { For } from 'solid-js';

function SemanticGroup(props: { title: string; hint?: string; children: unknown }) {
  return (
    <div class="mb-28">
      <div class="mb-4 text-12 font-semibold text-content-secondary">{props.title}</div>
      {props.hint && <p class="mb-12 text-11 text-content-muted">{props.hint}</p>}
      {props.children as never}
    </div>
  );
}

function TokenFootnote(props: { names: string[] }) {
  return (
    <div class="mt-10 flex flex-wrap gap-8">
      <For each={props.names}>
        {(name) => <code class="rounded-4 bg-surface-sunken px-6 py-2 text-9 text-content-faint">{name}</code>}
      </For>
    </div>
  );
}

export function SemanticColorsPreview() {
  const feedbackFamilies = [
    {
      label: 'Success',
      solid: 'bg-success-solid',
      strong: 'text-success-strong',
      softStyle: { background: 'var(--feedback-success-soft)' },
      border: 'border-success-border',
      tokens: ['--feedback-success-solid', '--feedback-success-strong', '--feedback-success-soft', '--feedback-success-border'],
    },
    {
      label: 'Warning',
      solid: 'bg-warning-solid',
      strong: 'text-warning-strong',
      softStyle: { background: 'var(--feedback-warning-soft)' },
      border: 'border-warning-border',
      tokens: ['--feedback-warning-solid', '--feedback-warning-strong', '--feedback-warning-soft', '--feedback-warning-border'],
    },
    {
      label: 'Danger',
      solid: 'bg-danger-solid',
      strong: 'text-danger-solid',
      softStyle: { background: 'var(--feedback-danger-soft)' },
      border: 'border-danger-border',
      tokens: ['--feedback-danger-solid', '--feedback-danger-strong', '--feedback-danger-soft', '--feedback-danger-border'],
    },
    {
      label: 'Info',
      solid: 'bg-info-solid',
      strong: 'text-info-strong',
      softStyle: { background: 'var(--feedback-info-soft)' },
      border: 'border-info-border',
      tokens: ['--feedback-info-solid', '--feedback-info-strong', '--feedback-info-soft', '--feedback-info-border'],
    },
  ] as const;

  return (
    <>
      <SemanticGroup title="表面 · Surfaces" hint="聊天画布为白（neutral-0）；侧栏与 Workbench 壳层为 Neutral 25（#fafafa）。Overlay 卡片保持白，避免改 overlay 波及气泡和按钮。">
        <div class="token-preview-surface-scene">
          <div class="token-preview-surface-canvas">
            <div class="token-preview-surface-sunken">
              <span class="text-11 font-medium text-content-secondary">Sunken panel</span>
              <span class="text-10 text-content-muted">列表凹槽、输入区底色</span>
            </div>
            <div class="token-preview-surface-overlay">
              <span class="text-12 font-semibold text-content-primary">Overlay card</span>
              <span class="text-11 text-content-muted">弹窗、菜单、浮层表面</span>
            </div>
          </div>
        </div>
        <TokenFootnote names={['--surface-canvas', '--surface-sunken', '--surface-overlay', '--palette-neutral-25', 'bg-neutral-25']} />
      </SemanticGroup>

      <SemanticGroup title="文字 · Content" hint="信息层级由强到弱；链接单独使用 accent 色系。">
        <div class="rounded-lg border border-border-subtle bg-surface-overlay p-16">
          <div class="text-15 font-semibold text-content-primary">Primary · 主标题与正文</div>
          <div class="mt-6 text-13 text-content-secondary">Secondary · 次级说明与副标题</div>
          <div class="mt-6 text-12 text-content-muted">Muted · 时间戳、计数、辅助 meta</div>
          <div class="mt-6 text-11 text-content-faint">Faint · 占位与最弱层级</div>
          <div class="mt-10 text-12 text-content-link underline">Link · 可点击路径与外链</div>
        </div>
        <TokenFootnote names={['--content-primary', '--content-secondary', '--content-muted', '--content-faint', '--content-link']} />
      </SemanticGroup>

      <SemanticGroup title="边框 · Borders" hint="subtle 为默认分隔；strong 用于强调；faint 用于极轻分割。">
        <div class="grid grid-cols-1 gap-12 compact:grid-cols-3">
          <div class="token-preview-border-card border-border-subtle">
            <span class="text-11 font-medium text-content-primary">border-subtle</span>
            <span class="text-10 text-content-muted">默认卡片与列表分隔</span>
          </div>
          <div class="token-preview-border-card border-border-strong">
            <span class="text-11 font-medium text-content-primary">border-strong</span>
            <span class="text-10 text-content-muted">强调边框、拖拽手柄</span>
          </div>
          <div class="token-preview-border-card border-border-faint">
            <span class="text-11 font-medium text-content-primary">border-faint</span>
            <span class="text-10 text-content-muted">极轻分割、内嵌表格</span>
          </div>
        </div>
        <TokenFootnote names={['--border-subtle', '--border-strong', '--border-faint']} />
      </SemanticGroup>

      <SemanticGroup title="主色 · Accent" hint="主操作、聚焦环与浅底标签。">
        <div class="flex flex-wrap items-center gap-12">
          <button type="button" class="token-preview-accent-button" disabled>
            Primary action
          </button>
          <span class="rounded-md border border-accent-border-hover bg-accent-soft px-10 py-6 text-11 font-medium text-accent-solid">
            Soft badge
          </span>
          <span class="token-preview-accent-ring text-11 text-content-secondary">Focus ring</span>
        </div>
        <TokenFootnote names={['--accent-solid', '--accent-hover', '--accent-soft', '--accent-border-hover', '--accent-ring', '--border-focus']} />
      </SemanticGroup>

      <SemanticGroup title="选中态 · Selection" hint="表行选中仅描边 + 白底，不使用彩色填充。">
        <div class="overflow-hidden rounded-lg border border-border-subtle">
          <div class="token-preview-selection-row">
            <span class="text-12 text-content-secondary">Default row</span>
          </div>
          <div class="token-preview-selection-row token-preview-selection-row--selected">
            <span class="text-12 font-medium text-content-primary">Selected row</span>
            <span class="text-10 text-content-muted">border only</span>
          </div>
          <div class="token-preview-selection-row">
            <span class="text-12 text-content-secondary">Default row</span>
          </div>
        </div>
        <TokenFootnote names={['--selection-border', '--selection-bg']} />
      </SemanticGroup>

      <SemanticGroup title="交互 · Interaction" hint="悬停叠层为半透明黑，适用于行 hover 与可点击区域。">
        <div class="overflow-hidden rounded-lg border border-border-subtle">
          <div class="token-preview-interaction-row">
            <span class="text-12 text-content-secondary">Rest state</span>
          </div>
          <div class="token-preview-interaction-row token-preview-interaction-row--hover">
            <span class="text-12 text-content-primary">Hover state</span>
            <span class="text-10 text-content-muted">bg-interaction-hover</span>
          </div>
        </div>
        <TokenFootnote names={['--interaction-hover']} />
      </SemanticGroup>

      <SemanticGroup title="反馈色矩阵 · Feedback" hint="solid / strong / soft / border 四档用于状态、提示与 inline notice。">
        <div class="grid grid-cols-1 gap-12 compact:grid-cols-2 diff-min:grid-cols-4">
          <For each={feedbackFamilies}>
            {(family) => (
              <div class="rounded-lg border border-border-subtle bg-surface-overlay p-12">
                <div class="mb-10 text-11 font-semibold text-content-primary">{family.label}</div>
                <div class="flex flex-col gap-8">
                  <div class={`h-28 rounded-md ${family.solid}`} title="solid" />
                  <div class={`text-12 font-semibold ${family.strong}`}>Strong label</div>
                  <div class="rounded-md px-10 py-8 text-11 text-content-secondary" style={family.softStyle}>
                    Soft surface copy
                  </div>
                  <div class={`rounded-md border-2 bg-surface-overlay px-10 py-8 text-11 text-content-secondary ${family.border}`}>
                    Border emphasis
                  </div>
                </div>
                <TokenFootnote names={[...family.tokens]} />
              </div>
            )}
          </For>
        </div>
      </SemanticGroup>
    </>
  );
}
