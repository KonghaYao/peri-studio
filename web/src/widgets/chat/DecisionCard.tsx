import { createSignal, For, Show, type JSX } from 'solid-js';
import { ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft } from 'lucide-solid';
import { Button, IconButton } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';

export type DecisionOption = {
  id: string;
  key: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

/** 决策卡壳：Questions / Permissions 共用（对齐 sandbox DecisionCard）。 */
export function DecisionCard(props: {
  class?: string;
  title: string;
  prompt: string;
  promptId?: string;
  detail?: string;
  options?: DecisionOption[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  currentIndex?: number;
  total?: number;
  onPrevious?: () => void;
  onNext?: () => void;
  pagerPreviousLabel?: string;
  pagerNextLabel?: string;
  collapseExpandedLabel?: string;
  collapseCollapsedLabel?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  skipLabel?: string;
  primaryLabel?: string;
  primaryType?: 'button' | 'submit';
  onSkip?: () => void;
  skipDisabled?: boolean;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  footer?: JSX.Element;
  headerActions?: JSX.Element;
  children?: JSX.Element;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-busy'?: boolean | 'true' | 'false';
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
      class={cn('overflow-hidden bg-surface-overlay shadow-decision', props.class)}
      style={{ 'border-radius': 'var(--decision-radius)' }}
      aria-label={props['aria-label']}
      aria-labelledby={props.promptId}
      aria-describedby={props['aria-describedby']}
      aria-busy={props['aria-busy']}
    >
      <header class="flex min-h-36 items-center gap-12 px-16 pt-14 pb-8">
        <span class="text-12 font-medium text-content-secondary">{props.title}</span>
        <span class="ml-auto flex items-center gap-2 text-content-muted">
          {props.headerActions}
          <Show when={showPager()}>
            <IconButton
              size="compact"
              label={props.pagerPreviousLabel ?? 'Previous'}
              class="border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary disabled:opacity-30"
              disabled={props.currentIndex === 0}
              onClick={props.onPrevious}
            >
              <ChevronLeft size={14} strokeWidth={1.8} />
            </IconButton>
            <span class="min-w-48 text-center text-10 tabular-nums text-content-muted">
              {props.currentIndex! + 1} / {props.total}
            </span>
            <IconButton
              size="compact"
              label={props.pagerNextLabel ?? 'Next'}
              class="border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary disabled:opacity-30"
              disabled={props.currentIndex! >= props.total! - 1}
              onClick={props.onNext}
            >
              <ChevronRight size={14} strokeWidth={1.8} />
            </IconButton>
          </Show>
          <IconButton
            size="compact"
            label={expanded() ? (props.collapseExpandedLabel ?? 'Collapse') : (props.collapseCollapsedLabel ?? 'Expand')}
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
        <div class="px-16 pb-8">
          <p id={props.promptId} class="text-13 font-semibold leading-snug text-content-primary">{props.prompt}</p>
          <Show when={props.detail}>
            <p class="mt-4 text-11 leading-snug text-content-muted">{props.detail}</p>
          </Show>
          {props.children}
          <Show when={props.options && props.options.length > 0}>
            <div class="mt-12 flex flex-col gap-2">
              <For each={props.options}>
                {(option) => {
                  const selected = () => props.selectedId === option.id;
                  return (
                    <button
                      type="button"
                      disabled={option.disabled}
                      onClick={() => props.onSelect?.(option.id)}
                      class={cn(
                        'flex w-full items-center gap-12 rounded-md px-8 py-6 text-left transition-colors duration-(--duration-fast)',
                        selected() ? 'bg-accent-soft' : 'hover:bg-interaction-hover',
                        option.disabled && 'cursor-not-allowed opacity-45',
                      )}
                    >
                      <span
                        class={cn(
                          'inline-flex size-20 shrink-0 items-center justify-center rounded-sm text-10 font-semibold',
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
          </Show>
        </div>

        <footer class="flex items-center justify-end gap-8 px-16 pb-14 pt-4">
          {props.footer ?? (
            <>
              <button
                type="button"
                class="inline-flex h-24 items-center px-8 text-12 text-content-muted transition-colors duration-(--duration-fast) hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-45"
                disabled={props.skipDisabled}
                onClick={props.onSkip}
              >
                {props.skipLabel ?? 'Skip'}
              </button>
              <Button
                type={props.primaryType ?? 'button'}
                size="sm"
                variant="primary"
                class="rounded-full border-0 px-14 text-13 focus-visible:shadow-(--shadow-focus-ring)"
                disabled={props.primaryDisabled}
                busy={props.primaryBusy}
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
