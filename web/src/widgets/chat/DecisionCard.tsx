import { createSignal, For, Show, type JSX } from 'solid-js';
import { ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft } from 'lucide-solid';
import { Button, IconButton } from '../../components/ui';
import { cn } from '../../shared/lib/cn';

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
      <header class="flex min-h-36 items-center gap-6 px-12 pt-10 pb-6">
        <span class="text-11 font-650 text-text-secondary">{props.title}</span>
        <span class="ml-auto flex items-center gap-1 text-text-muted">
          {props.headerActions}
          <Show when={showPager()}>
            <IconButton
              size="compact"
              label={props.pagerPreviousLabel ?? 'Previous'}
              class="border-0 bg-transparent text-text-muted hover:bg-transparent hover:text-text-primary disabled:opacity-30"
              disabled={props.currentIndex === 0}
              onClick={props.onPrevious}
            >
              <ChevronLeft size={13} strokeWidth={1.8} />
            </IconButton>
            <span class="min-w-26 text-center text-9 tabular-nums text-text-muted">
              {props.currentIndex! + 1} / {props.total}
            </span>
            <IconButton
              size="compact"
              label={props.pagerNextLabel ?? 'Next'}
              class="border-0 bg-transparent text-text-muted hover:bg-transparent hover:text-text-primary disabled:opacity-30"
              disabled={props.currentIndex! >= props.total! - 1}
              onClick={props.onNext}
            >
              <ChevronRight size={13} strokeWidth={1.8} />
            </IconButton>
          </Show>
          <IconButton
            size="compact"
            label={expanded() ? (props.collapseExpandedLabel ?? 'Collapse') : (props.collapseCollapsedLabel ?? 'Expand')}
            class="border-0 bg-transparent text-text-muted hover:bg-transparent hover:text-text-primary"
            aria-expanded={expanded()}
            onClick={toggleExpanded}
          >
            <ChevronDown
              size={14}
              strokeWidth={1.8}
              class={cn('transition-transform duration-120', !expanded() && 'rotate-180')}
            />
          </IconButton>
        </span>
      </header>

      <Show when={expanded()}>
        <div class="px-12 pb-6">
          <p id={props.promptId} class="text-12 font-600 leading-snug text-text-primary">{props.prompt}</p>
          <Show when={props.detail}>
            <p class="mt-3 text-10 leading-snug text-text-muted">{props.detail}</p>
          </Show>
          {props.children}
          <Show when={props.options && props.options.length > 0}>
            <div class="mt-6 flex flex-col gap-1">
              <For each={props.options}>
                {(option) => {
                  const selected = () => props.selectedId === option.id;
                  return (
                    <button
                      type="button"
                      disabled={option.disabled}
                      onClick={() => props.onSelect?.(option.id)}
                      class={cn(
                        'flex w-full items-center gap-7 rounded-7 px-6 py-4 text-left transition-colors duration-120',
                        selected() ? 'bg-accent-soft' : 'hover:bg-interaction-hover',
                        option.disabled && 'cursor-not-allowed opacity-45',
                      )}
                    >
                      <span
                        class={cn(
                          'inline-flex size-18 shrink-0 items-center justify-center rounded-5 text-9 font-650',
                          selected()
                            ? 'bg-accent-solid text-content-on-accent'
                            : 'bg-surface-sunken text-text-muted',
                        )}
                        aria-hidden="true"
                      >
                        {option.key}
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-10 text-text-primary">{option.label}</span>
                        <Show when={option.detail}>
                          <span class="block truncate text-9 text-text-muted">{option.detail}</span>
                        </Show>
                      </span>
                    </button>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>

        <footer class="flex items-center justify-end gap-4 px-12 pb-10 pt-2">
          {props.footer ?? (
            <>
              <button
                type="button"
                class="inline-flex h-24 items-center px-8 text-12 text-text-muted transition-colors duration-120 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
                disabled={props.skipDisabled}
                onClick={props.onSkip}
              >
                {props.skipLabel ?? 'Skip'}
              </button>
              <Button
                type={props.primaryType ?? 'button'}
                size="sm"
                variant="primary"
                class="rounded-full border-0 bg-accent-solid px-11 text-content-on-accent hover:bg-accent-hover active:bg-accent-active focus-visible:shadow-(--shadow-focus-ring)"
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
