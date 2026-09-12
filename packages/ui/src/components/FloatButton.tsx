import { ArrowUp, Plus } from 'lucide-solid';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  Show,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { createControllableSignal } from '../lib/controllable-state';

const floatButtonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center border shadow-overlay transition-colors outline-none duration-120 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'border-border-strong bg-surface-overlay text-content-primary hover:bg-interaction-hover',
        primary:
          'border-transparent bg-accent-solid [color:var(--content-on-accent)]! hover:bg-accent-hover active:bg-accent-active',
      },
      shape: {
        circle: 'rounded-full',
        square: 'rounded-8',
      },
      size: {
        default: 'min-h-44 min-w-44 gap-6 px-12 text-13',
        compact: 'min-h-36 min-w-36 gap-4 px-8 text-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      shape: 'circle',
      size: 'default',
    },
  },
);

type FloatButtonVariantProps = VariantProps<typeof floatButtonVariants>;

type FloatButtonProps = ComponentProps<'button'> &
  FloatButtonVariantProps & {
    icon?: JSX.Element;
    content?: JSX.Element;
    /** @deprecated 使用 content */
    description?: JSX.Element;
    href?: string;
    target?: string;
    badge?: { count?: number; dot?: boolean };
    tooltip?: string;
  };

type FloatButtonGroupContextValue = {
  inGroup: boolean;
};

const FloatButtonGroupContext = createContext<FloatButtonGroupContextValue>({ inGroup: false });

function FloatButtonRoot(props: FloatButtonProps) {
  const [local, variants, rest] = splitProps(
    props,
    ['class', 'children', 'icon', 'content', 'description', 'href', 'target', 'badge', 'tooltip', 'variant', 'shape', 'size'],
    ['variant', 'shape', 'size'],
  );
  const group = useContext(FloatButtonGroupContext);
  const label = () => local.content ?? local.description ?? local.children;
  const classes = cn(
    floatButtonVariants({
      variant: variants.variant,
      shape: variants.shape,
      size: variants.size,
    }),
    group.inGroup && 'shadow-none',
    local.class,
  );

  const body = () => (
    <>
      <Show when={local.icon}>{local.icon}</Show>
      <Show when={label()}>{label()}</Show>
    </>
  );

  const withBadge = (node: JSX.Element) => {
    if (!local.badge) return node;
    return (
      <span data-slot="float-button-badge" class="relative inline-flex">
        {node}
        <Show
          when={local.badge.dot}
          fallback={
            <Show when={(local.badge.count ?? 0) > 0}>
              <span
                class="absolute -top-4 -right-4 flex min-w-16 items-center justify-center rounded-full bg-danger px-4 text-10 font-medium text-content-on-accent"
                aria-hidden="true"
              >
                {local.badge.count}
              </span>
            </Show>
          }
        >
          <span class="absolute top-4 right-4 size-8 rounded-full bg-danger" aria-hidden="true" />
        </Show>
      </span>
    );
  };

  if (local.href) {
    return withBadge(
      <a
        data-slot="float-button"
        href={local.href}
        target={local.target}
        title={local.tooltip}
        class={classes}
        {...(rest as ComponentProps<'a'>)}
      >
        {body()}
      </a>,
    );
  }

  return withBadge(
    <button
      type="button"
      data-slot="float-button"
      title={local.tooltip}
      class={classes}
      {...rest}
    >
      {body()}
    </button>,
  );
}

type FloatButtonGroupProps = ComponentProps<'div'> & {
  trigger?: 'click' | 'hover';
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  closeIcon?: JSX.Element;
};

const PLACEMENT_CLASS: Record<NonNullable<FloatButtonGroupProps['placement']>, string> = {
  top: 'bottom-full left-1/2 mb-8 -translate-x-1/2 flex-col-reverse',
  bottom: 'top-full left-1/2 mt-8 -translate-x-1/2 flex-col',
  left: 'right-full top-1/2 mr-8 -translate-y-1/2 flex-row-reverse',
  right: 'left-full top-1/2 ml-8 -translate-y-1/2 flex-row',
};

export const FloatButtonGroup: Component<FloatButtonGroupProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'trigger',
    'open',
    'defaultOpen',
    'onOpenChange',
    'placement',
    'closeIcon',
  ]);

  const [open, setOpen] = createControllableSignal<boolean>({
    prop: () => local.open,
    defaultProp: local.defaultOpen ?? false,
    onChange: local.onOpenChange,
  });

  const trigger = () => local.trigger ?? 'click';
  const placement = () => local.placement ?? 'top';

  const show = () => open();
  const toggle = () => setOpen(!open());

  return (
    <FloatButtonGroupContext.Provider value={{ inGroup: true }}>
      <div
        data-slot="float-button-group"
        data-open={show() ? 'true' : 'false'}
        class={cn('relative inline-flex', local.class)}
        onMouseEnter={() => trigger() === 'hover' && setOpen(true)}
        onMouseLeave={() => trigger() === 'hover' && setOpen(false)}
        {...rest}
      >
        <Show when={show()}>
          <div
            data-slot="float-button-group-list"
            class={cn('absolute z-10 flex gap-8', PLACEMENT_CLASS[placement()])}
          >
            {local.children}
          </div>
        </Show>
        <FloatButton
          variant="primary"
          shape="circle"
          icon={show() ? (local.closeIcon ?? <Plus class="size-16 rotate-45" />) : <Plus class="size-16" />}
          aria-label={show() ? 'Close actions' : 'Open actions'}
          onClick={() => trigger() === 'click' && toggle()}
        />
      </div>
    </FloatButtonGroupContext.Provider>
  );
};

type FloatButtonBackTopProps = Omit<FloatButtonProps, 'href' | 'target'> & {
  visibilityHeight?: number;
  duration?: number;
  target?: () => HTMLElement | Window | Document;
};

export const FloatButtonBackTop: Component<FloatButtonBackTopProps> = (props) => {
  const [local, rest] = splitProps(props, ['visibilityHeight', 'duration', 'target', 'onClick', 'class', 'children']);
  const [visible, setVisible] = createSignal(false);

  const getTarget = () => {
    const target = local.target?.();
    if (!target || target === document) return window;
    return target as HTMLElement | Window;
  };

  const updateVisible = () => {
    const target = getTarget();
    const scrollTop =
      target === window ? window.scrollY : (target as HTMLElement).scrollTop;
    setVisible(scrollTop >= (local.visibilityHeight ?? 400));
  };

  const scrollToTop = (event: MouseEvent) => {
    const target = getTarget();
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = prefersReducedMotion ? 0 : (local.duration ?? 450);
    const start = target === window ? window.scrollY : (target as HTMLElement).scrollTop;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = duration === 0 ? 1 : Math.min(elapsed / duration, 1);
      const next = start * (1 - progress);
      if (target === window) {
        window.scrollTo(0, next);
      } else {
        (target as HTMLElement).scrollTop = next;
      }
      if (progress < 1) requestAnimationFrame(step);
    };

    requestAnimationFrame(step);
    const handler = local.onClick;
    if (typeof handler === 'function') {
      (handler as (event: MouseEvent) => void)(event);
    }
  };

  onMount(() => {
    const target = getTarget();
    const handler = () => updateVisible();
    updateVisible();
    target.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler, { passive: true });
    onCleanup(() => {
      target.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    });
  });

  return (
    <Show when={visible()}>
      <FloatButton
        data-slot="float-button-back-top"
        variant="default"
        shape="circle"
        icon={<ArrowUp class="size-16" />}
        aria-label="Back to top"
        class={cn('fixed right-24 bottom-24 z-50', local.class)}
        onClick={scrollToTop}
        {...rest}
      />
    </Show>
  );
};

export const FloatButton = Object.assign(FloatButtonRoot, {
  Group: FloatButtonGroup,
  BackTop: FloatButtonBackTop,
});
