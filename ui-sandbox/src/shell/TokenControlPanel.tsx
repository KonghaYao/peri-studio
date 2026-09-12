import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { ChevronDown, GripHorizontal, RotateCcw, SlidersHorizontal, X } from 'lucide-solid';
import {
  clearAllTokenOverrides,
  clearTokenOverride,
  exportOverridesCss,
  getOverrideCount,
  getTokenDefault,
  getTokenValue,
  groupTokensForEditor,
  inferTokenInputKind,
  isTokenOverridden,
  resolvedColorHex,
  setTokenOverride,
  subscribeTokenEditor,
  type TokenGroup,
  type TokenInputKind,
} from '@/lib/token-editor';
import { readDesignTokens, resolveToken, type TokenEntry } from '@/lib/token-reader';
import { Button, cn, CopyButton, IconButton, Input } from '@/lib/catalog-ui';
import { isBasicsPanelToken } from '@/lib/token-basics';
import { isPaletteToken, subscribePaletteEditor } from '@/lib/palette-scale';
import { PaletteScaleSection } from '@/shell/PaletteScaleSection';

function TokenPreview(props: { entry: TokenEntry; kind: TokenInputKind }) {
  const previewStyle = createMemo(() => {
    if (props.kind !== 'color') return undefined;
    return { background: `var(${props.entry.name})` };
  });

  return (
    <span
      class="size-20 flex-none rounded-4 border border-border-subtle"
      classList={{ 'bg-surface-muted': props.kind !== 'color' }}
      style={previewStyle()}
      aria-hidden="true"
    />
  );
}

function TokenControlRow(props: { entry: TokenEntry }) {
  const [draft, setDraft] = createSignal(getTokenValue(props.entry.name));
  const [editorTick, setEditorTick] = createSignal(0);

  onMount(() => subscribeTokenEditor(() => setEditorTick((value) => value + 1)));

  createEffect(() => {
    editorTick();
    setDraft(getTokenValue(props.entry.name));
  });

  const kind = () => inferTokenInputKind(props.entry.name, draft());
  const overridden = () => isTokenOverridden(props.entry.name);
  const resolved = () => resolveToken(props.entry.name, kind() === 'color' ? 'color' : 'width');
  const colorHex = () => (kind() === 'color' ? resolvedColorHex(props.entry.name) : null);

  const commit = (next: string) => {
    setDraft(next);
    setTokenOverride(props.entry.name, next);
  };

  return (
    <div class="flex flex-col gap-6 px-10 py-8 token-control-row" classList={{ 'bg-accent-soft/40': overridden() }}>
      <div class="flex min-w-0 items-center gap-8">
        <TokenPreview entry={props.entry} kind={kind()} />
        <code class="truncate text-10 text-content-primary" title={props.entry.name}>{props.entry.name}</code>
      </div>

      <div class="flex min-w-0 items-center gap-6">
        <Show when={kind() === 'color' && colorHex()}>
          <input
            type="color"
            class="token-control-color-input"
            value={colorHex()!}
            aria-label={`Pick color for ${props.entry.name}`}
            onInput={(event) => commit(event.currentTarget.value)}
          />
        </Show>
        <Input
          class="min-w-0 flex-1 font-mono text-11"
          value={draft()}
          aria-label={`Value for ${props.entry.name}`}
          onInput={(event) => commit(event.currentTarget.value)}
        />
        <IconButton
          label={`Reset ${props.entry.name}`}
          size="sm"
          disabled={!overridden()}
          onClick={() => {
            clearTokenOverride(props.entry.name);
            setDraft(getTokenDefault(props.entry.name));
          }}
        >
          <RotateCcw size={14} />
        </IconButton>
      </div>

      <div class="truncate font-mono text-9 text-content-faint" title={resolved()}>
        {resolved()}
        <Show when={overridden()}>
          <span class="ml-6 text-content-muted">default: {getTokenDefault(props.entry.name)}</span>
        </Show>
      </div>
    </div>
  );
}

function TokenGroupSection(props: {
  group: TokenGroup;
  collapsed: boolean;
  query: string;
  onToggle: () => void;
}) {
  const rows = createMemo(() => {
    const q = props.query.trim().toLowerCase();
    if (!q) return props.group.entries;
    return props.group.entries.filter(
      (entry) => entry.name.toLowerCase().includes(q) || entry.value.toLowerCase().includes(q),
    );
  });

  return (
    <Show when={rows().length > 0}>
      <section class="border-b border-border-subtle">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-8 px-10 py-8 text-left transition-colors hover:bg-interaction-hover"
          onClick={props.onToggle}
        >
          <span class="text-11 font-semibold text-content-secondary">{props.group.label}</span>
          <span class="flex items-center gap-6 text-10 text-content-muted">
            {rows().length}
            <ChevronDown size={14} class={cn('transition-transform', !props.collapsed && 'rotate-180')} />
          </span>
        </button>
        <Show when={!props.collapsed}>
          <div class="border-t border-border-faint">
            <For each={rows()}>
              {(entry) => <TokenControlRow entry={entry} />}
            </For>
          </div>
        </Show>
      </section>
    </Show>
  );
}

export function TokenControlPanel() {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [overrideCount, setOverrideCount] = createSignal(getOverrideCount());
  const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({});
  const [position, setPosition] = createSignal({ x: 16, y: 16 });

  const entries = createMemo(() => readDesignTokens());
  const groups = createMemo(() => groupTokensForEditor(entries()));
  const isEditableToken = (name: string) => !isPaletteToken(name) && !isBasicsPanelToken(name);

  const editableCount = createMemo(() => entries().filter((entry) => isEditableToken(entry.name)).length);

  const filteredCount = createMemo(() => {
    const q = query().trim().toLowerCase();
    const editable = entries().filter((entry) => isEditableToken(entry.name));
    if (!q) return editable.length;
    return editable.filter(
      (entry) => entry.name.toLowerCase().includes(q) || entry.value.toLowerCase().includes(q),
    ).length;
  });

  onMount(() => {
    const refreshCount = () => setOverrideCount(getOverrideCount());
    const unsubTokens = subscribeTokenEditor(refreshCount);
    const unsubPalettes = subscribePaletteEditor(refreshCount);
    onCleanup(() => {
      unsubTokens();
      unsubPalettes();
    });
  });

  const toggleGroup = (id: string) => {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  };

  onMount(() => {
    const panelWidth = 400;
    const panelHeight = 520;
    const x = Math.max(16, window.innerWidth - panelWidth - 16);
    const y = Math.max(16, window.innerHeight - panelHeight - 16);
    setPosition({ x, y });
  });

  let dragState: { startX: number; startY: number; originX: number; originY: number } | null = null;

  const onDragStart = (event: PointerEvent) => {
    if (event.button !== 0) return;
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position().x,
      originY: position().y,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: PointerEvent) => {
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    setPosition({
      x: Math.max(8, dragState.originX + dx),
      y: Math.max(8, dragState.originY + dy),
    });
  };

  const onDragEnd = (event: PointerEvent) => {
    if (!dragState) return;
    dragState = null;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  };

  onCleanup(() => {
    dragState = null;
  });

  return (
    <>
      <Show when={!open()}>
        <IconButton
          label="Open token controls"
          class="token-control-fab"
          onClick={() => setOpen(true)}
        >
          <SlidersHorizontal size={18} />
        </IconButton>
      </Show>

      <Show when={open()}>
        <div
          class="token-control-panel"
          style={{ left: `${position().x}px`, top: `${position().y}px` }}
          role="dialog"
          aria-label="Token controls"
        >
          <header
            class="token-control-panel__header"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div class="flex min-w-0 items-center gap-8">
              <GripHorizontal size={16} class="shrink-0 text-content-faint" aria-hidden="true" />
              <div class="min-w-0">
                <div class="text-13 font-semibold text-content-primary">Token controls</div>
                <div class="text-10 text-content-muted">
                  {overrideCount()} overridden · {filteredCount()}/{editableCount()} tokens
                </div>
              </div>
            </div>
            <IconButton label="Close token controls" size="sm" onClick={() => setOpen(false)}>
              <X size={16} />
            </IconButton>
          </header>

          <div class="token-control-panel__toolbar">
            <Input
              class="w-full text-12"
              placeholder="Search tokens…"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
            <div class="flex flex-wrap gap-6">
              <Button
                size="sm"
                variant="default"
                disabled={overrideCount() === 0}
                onClick={() => clearAllTokenOverrides()}
              >
                Reset all
              </Button>
              <CopyButton text={exportOverridesCss()} label="Export CSS overrides" size="sm" />
            </div>
          </div>

          <div class="token-control-panel__body">
            <PaletteScaleSection
              collapsed={!!collapsed()['palette-scales']}
              onToggle={() => toggleGroup('palette-scales')}
            />
            <For each={groups()}>
              {(group) => (
                <TokenGroupSection
                  group={group}
                  query={query()}
                  collapsed={!!collapsed()[group.id]}
                  onToggle={() => toggleGroup(group.id)}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </>
  );
}
