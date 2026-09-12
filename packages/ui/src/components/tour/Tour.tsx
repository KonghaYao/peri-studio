import { createSignal, Show, splitProps, type Component, type JSX } from 'solid-js';
import { Button } from '../Button';

export type TourStep = {
  target?: string;
  title?: JSX.Element;
  description?: JSX.Element;
  placement?: 'top' | 'bottom' | 'left' | 'right';
};

export type TourProps = {
  open?: boolean;
  current?: number;
  steps?: TourStep[];
  onClose?: () => void;
  onChange?: (current: number) => void;
  mask?: boolean;
};

function rectForSelector(selector?: string): DOMRect | null {
  if (!selector) return null;
  const el = document.querySelector(selector);
  return el?.getBoundingClientRect() ?? null;
}

/** 引导蒙层：按步骤高亮目标并展示说明。 */
export const Tour: Component<TourProps> = (props) => {
  const [local] = splitProps(props, ['open', 'current', 'steps', 'onClose', 'onChange', 'mask']);
  const stepIndex = () => local.current ?? 0;
  const step = () => local.steps?.[stepIndex()];
  const rect = () => rectForSelector(step()?.target);
  const placement = () => step()?.placement ?? 'bottom';

  const popoverStyle = () => {
    const box = rect();
    if (!box) {
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
    const gap = 12;
    if (placement() === 'top') {
      return { top: `${box.top - gap}px`, left: `${box.left + box.width / 2}px`, transform: 'translate(-50%, -100%)' };
    }
    if (placement() === 'left') {
      return { top: `${box.top + box.height / 2}px`, left: `${box.left - gap}px`, transform: 'translate(-100%, -50%)' };
    }
    if (placement() === 'right') {
      return { top: `${box.top + box.height / 2}px`, left: `${box.right + gap}px`, transform: 'translateY(-50%)' };
    }
    return { top: `${box.bottom + gap}px`, left: `${box.left + box.width / 2}px`, transform: 'translateX(-50%)' };
  };

  const next = () => {
    const last = (local.steps?.length ?? 1) - 1;
    if (stepIndex() >= last) {
      local.onClose?.();
      return;
    }
    local.onChange?.(stepIndex() + 1);
  };

  const prev = () => local.onChange?.(Math.max(0, stepIndex() - 1));

  return (
    <Show when={local.open}>
      <div data-slot="tour" class="fixed inset-0 z-80">
        <Show when={local.mask !== false}>
          <div class="absolute inset-0 bg-scrim/60" aria-hidden="true" />
        </Show>
        <Show when={rect()}>
          {(box) => (
            <div
              class="pointer-events-none absolute rounded-8 ring-2 ring-accent-solid ring-offset-2 ring-offset-transparent"
              style={{
                top: `${box().top}px`,
                left: `${box().left}px`,
                width: `${box().width}px`,
                height: `${box().height}px`,
              }}
            />
          )}
        </Show>
        <div
          data-slot="tour-panel"
          class="absolute z-81 w-(--container-dialog-compact) max-w-360 rounded-8 border border-border-subtle bg-surface p-16 shadow-popover"
          style={popoverStyle() as Record<string, string>}
          role="dialog"
          aria-modal="true"
        >
          <Show when={step()?.title}>
            <div class="mb-8 text-14 font-semibold text-content-primary">{step()?.title}</div>
          </Show>
          <Show when={step()?.description}>
            <div class="mb-12 text-13 text-content-muted">{step()?.description}</div>
          </Show>
          <div class="flex items-center justify-between gap-8">
            <span class="text-12 text-content-muted">
              {stepIndex() + 1} / {local.steps?.length ?? 0}
            </span>
            <div class="flex gap-8">
              <Button variant="ghost" size="sm" disabled={stepIndex() <= 0} onClick={prev}>Previous</Button>
              <Button variant="primary" size="sm" onClick={next}>
                {stepIndex() >= (local.steps?.length ?? 1) - 1 ? 'Finish' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};

export function useTour(steps: TourStep[]) {
  const [open, setOpen] = createSignal(false);
  const [current, setCurrent] = createSignal(0);
  return {
    open,
    current,
    steps,
    start: () => {
      setCurrent(0);
      setOpen(true);
    },
    close: () => setOpen(false),
    setCurrent,
  };
}
