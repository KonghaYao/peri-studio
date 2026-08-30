import type { Component, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as TooltipPrimitive from '@kobalte/core/tooltip';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../lib/cn';

const tooltipClasses = 'fixed z-80 w-max max-w-240 rounded-6 bg-content-primary px-8 py-4 text-12 font-normal leading-snug text-surface-canvas shadow-overlay pointer-events-none whitespace-normal animate-[ui-tooltip-in_120ms_ease-out] data-[placement=bottom]:-translate-x-1/2 data-[placement=bottom-start]:translate-x-0 data-[placement=bottom-end]:-translate-x-full data-[placement=top]:-translate-x-1/2 data-[placement=top]:-translate-y-full data-[placement=top-start]:-translate-y-full data-[placement=top-end]:-translate-x-full data-[placement=top-end]:-translate-y-full motion-reduce:animate-none';

const Tooltip: Component<TooltipPrimitive.TooltipRootProps> = (props) => <TooltipPrimitive.Root gutter={4} openDelay={200} {...props} />;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = <T extends ValidComponent = 'div'>(props: PolymorphicProps<T, TooltipPrimitive.TooltipContentProps<T> & { class?: string }>) => {
  const [local, others] = splitProps(props as TooltipPrimitive.TooltipContentProps & { class?: string }, ['class']);
  return <TooltipPrimitive.Portal><TooltipPrimitive.Content class={cn(tooltipClasses, local.class)} {...others} /></TooltipPrimitive.Portal>;
};

export { Tooltip, TooltipContent, TooltipTrigger };
