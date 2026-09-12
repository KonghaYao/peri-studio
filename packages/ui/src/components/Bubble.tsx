import { cva, type VariantProps } from 'class-variance-authority';
import {
  createContext,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../lib/cn';

export type BubbleVariant = 'default' | 'primary' | 'muted' | 'outline' | 'ghost';
export type BubbleAlign = 'start' | 'end';
export type BubbleReactionSide = 'top' | 'bottom';
export type BubbleReactionAlign = 'start' | 'end';

export const bubbleVariants = cva('relative flex min-w-0 flex-col', {
  variants: {
    variant: {
      default: 'max-w-(--max-width-chat-bubble)',
      primary: 'max-w-(--max-width-chat-bubble)',
      muted: 'max-w-(--max-width-chat-bubble)',
      outline: 'max-w-(--max-width-chat-bubble)',
      ghost: 'w-full max-w-none',
    },
    align: {
      start: 'self-start',
      end: 'self-end',
    },
  },
  defaultVariants: {
    variant: 'default',
    align: 'start',
  },
});

const bubbleContentVariants = cva('min-w-0 wrap-anywhere leading-normal', {
  variants: {
    variant: {
      default:
        'rounded-8 border border-border-subtle bg-surface px-12 py-8 text-13 text-content-primary',
      primary: 'rounded-8 bg-accent-solid px-12 py-8 text-13 text-content-on-accent',
      muted: 'rounded-8 bg-surface-muted px-12 py-8 text-13 text-content-secondary',
      outline:
        'rounded-8 border border-border-strong bg-transparent px-12 py-8 text-13 text-content-primary',
      ghost: 'bg-transparent px-0 py-0 text-content-primary',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type BubbleContextValue = {
  variant: () => BubbleVariant;
  align: () => BubbleAlign;
};

const BubbleContext = createContext<BubbleContextValue>();

function useBubbleContext(component: string): BubbleContextValue {
  const context = useContext(BubbleContext);
  if (!context) {
    throw new Error(`${component} must be used within Bubble`);
  }
  return context;
}

type BubbleProps = ComponentProps<'div'> & VariantProps<typeof bubbleVariants>;

/** 会话气泡根容器：承载 variant 与对齐。 */
export const Bubble: Component<BubbleProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'variant', 'align']);
  const variant = () => local.variant ?? 'default';
  const align = () => local.align ?? 'start';
  return (
    <BubbleContext.Provider value={{ variant, align }}>
      <div
        data-slot="bubble"
        data-variant={variant()}
        data-align={align()}
        class={cn(bubbleVariants({ variant: variant(), align: align() }), local.class)}
        {...rest}
      />
    </BubbleContext.Provider>
  );
};

/** 气泡正文表面。 */
export const BubbleContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const { variant } = useBubbleContext('BubbleContent');
  return (
    <div
      data-slot="bubble-content"
      class={cn(bubbleContentVariants({ variant: variant() }), local.class)}
      {...rest}
    />
  );
};

const bubbleReactionSideClasses: Record<BubbleReactionSide, string> = {
  top: 'bottom-full mb-4',
  bottom: 'top-full mt-4',
};

const bubbleReactionAlignClasses: Record<BubbleReactionAlign, string> = {
  start: 'left-0',
  end: 'right-0',
};

type BubbleReactionsProps = ComponentProps<'div'> & {
  side?: BubbleReactionSide;
  align?: BubbleReactionAlign;
};

/** 气泡反应/快捷操作行，锚定在气泡边缘。 */
export const BubbleReactions: Component<BubbleReactionsProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'side', 'align']);
  const side = () => local.side ?? 'bottom';
  const align = () => local.align ?? 'end';
  useBubbleContext('BubbleReactions');
  return (
    <div
      data-slot="bubble-reactions"
      data-side={side()}
      data-align={align()}
      class={cn(
        'absolute flex items-center gap-4 text-12',
        bubbleReactionSideClasses[side()],
        bubbleReactionAlignClasses[align()],
        local.class,
      )}
      {...rest}
    />
  );
};

/** 同一发送者的连续气泡分组。 */
export const BubbleGroup: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-slot="bubble-group"
      class={cn('flex min-w-0 flex-col gap-4', local.class)}
      {...rest}
    />
  );
};
