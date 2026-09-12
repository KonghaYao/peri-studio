import { createSignal, For, Show, type JSX } from 'solid-js';
import { ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft } from 'lucide-solid';
import { Button, IconButton } from '@/lib/catalog-ui';
import { cn } from '@/lib/catalog-ui';

export type DecisionOption = {
  id: string;
  key: string;
  label: string;
  detail?: string;
};

/** 决策卡壳：Questions / Permissions 共用（参考 Cursor 式问答面板）。 */
export function DecisionCard(props: {
  title: string;
  prompt: string;
  detail?: string;
  options: DecisionOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  currentIndex?: number;
  total?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  skipLabel?: string;
  primaryLabel?: string;
  onSkip?: () => void;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  footer?: JSX.Element;
}) {
  const [localExpanded, setLocalExpanded] = createSignal(true);
  const showPager = () => (props.total ?? 0) > 1;
  const expanded = () => props.expanded ?? localExpanded();
  const toggleExpanded = () => {
    const next = !expanded();
    if (props.onExpandedChange) props.onExpandedChange(next);
    else setLocalExpanded(next);
  };

  return (
    <section
      class="overflow-hidden bg-surface-overlay shadow-decision"
      style={{ 'border-radius': 'var(--decision-radius)' }}
    >
      <header class="flex min-h-9 items-center gap-3 px-4 pt-3.5 pb-2">
        <span class="text-12 font-medium text-content-secondary">{props.title}</span>
        <span class="ml-auto flex items-center gap-0.5 text-content-muted">
          <Show when={showPager()}>
            <IconButton
              size="sm"
              label="Previous"
              class="border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary disabled:opacity-30"
              disabled={props.currentIndex === 0}
              onClick={props.onPrevious}
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </IconButton>
            <span class="min-w-12 text-center text-10 tabular-nums text-content-muted">
              {props.currentIndex! + 1} of {props.total}
            </span>
            <IconButton
              size="sm"
              label="Next"
              class="border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary disabled:opacity-30"
              disabled={props.currentIndex! >= props.total! - 1}
              onClick={props.onNext}
            >
              <ChevronRight size={14} strokeWidth={1.8} />
            </IconButton>
          </Show>
          <IconButton
            size="sm"
            label={expanded() ? 'Collapse' : 'Expand'}
            class="border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary"
            aria-expanded={expanded()}
            onClick={toggleExpanded}
          >
            <ChevronDown
              size={14}
              strokeWidth={1.8}
              class={cn('transition-transform duration-(--duration-fast)', !expanded() && 'rotate-180')}
            />
          </IconButton>
        </span>
      </header>

      <Show when={expanded()}>
        <div class="px-4 pb-2">
          <p class="text-13 font-semibold leading-snug text-content-primary">{props.prompt}</p>
          <Show when={props.detail}>
            <p class="mt-1 text-11 leading-snug text-content-muted">{props.detail}</p>
          </Show>
          <div class="mt-3 flex flex-col gap-0.5">
            <For each={props.options}>
              {(option) => {
                const selected = () => props.selectedId === option.id;
                return (
                  <button
                    type="button"
                    onClick={() => props.onSelect(option.id)}
                    class={cn(
                      'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-(--duration-fast)',
                      selected()
                        ? 'bg-accent-soft'
                        : 'hover:bg-interaction-hover',
                    )}
                  >
                    <span
                      class={cn(
                        'inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-10 font-semibold',
                        selected()
                          ? 'bg-accent-solid text-content-on-accent'
                          : 'bg-surface-sunken text-content-muted',
                      )}
                      aria-hidden="true"
                    >
                      {option.key}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-12 text-content-primary">{option.label}</span>
                      <Show when={option.detail}>
                        <span class="block truncate text-10 text-content-muted">{option.detail}</span>
                      </Show>
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>

        <footer class="flex items-center justify-end gap-2 px-4 pb-3.5 pt-1">
          {props.footer ?? (
            <>
              <button
                type="button"
                class="inline-flex h-(--control-height-sm) items-center px-2 text-12 text-content-muted transition-colors duration-(--duration-fast) hover:text-content-primary"
                onClick={props.onSkip}
              >
                {props.skipLabel ?? 'Skip'}
              </button>
              <Button
                size="sm"
                variant="primary"
                class="rounded-full border-0 px-3.5 focus-visible:shadow-(--shadow-focus-ring)"
                disabled={props.primaryDisabled}
                onClick={props.onPrimary}
              >
                {props.primaryLabel ?? 'Next'}
                <CornerDownLeft size={14} strokeWidth={2} class="opacity-90" aria-hidden="true" />
              </Button>
            </>
          )}
        </footer>
      </Show>
    </section>
  );
}
