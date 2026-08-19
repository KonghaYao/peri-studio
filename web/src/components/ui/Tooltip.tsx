import type { Component, ValidComponent } from 'solid-js';
import { splitProps } from 'solid-js';
import * as TooltipPrimitive from '@kobalte/core/tooltip';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../../lib/cn';

const Tooltip: Component<TooltipPrimitive.TooltipRootProps> = (props) => <TooltipPrimitive.Root gutter={4} openDelay={450} {...props} />;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = <T extends ValidComponent = 'div'>(props: PolymorphicProps<T, TooltipPrimitive.TooltipContentProps<T> & { class?: string }>) => {
  const [local, others] = splitProps(props as TooltipPrimitive.TooltipContentProps & { class?: string }, ['class']);
  return <TooltipPrimitive.Portal><TooltipPrimitive.Content class={cn('ui-tooltip', local.class)} {...others} /></TooltipPrimitive.Portal>;
};

export { Tooltip, TooltipContent, TooltipTrigger };
