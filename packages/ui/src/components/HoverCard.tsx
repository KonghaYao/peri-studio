import type { Component, ValidComponent } from "solid-js"
import { splitProps } from "solid-js"
import * as HoverCardPrimitive from "@kobalte/core/hover-card"
import type { PolymorphicProps } from "@kobalte/core/polymorphic"
import { cn } from "../lib/cn"
import { surfacePopoverMotion } from "../lib/overlay-motion"

const HoverCard: Component<HoverCardPrimitive.HoverCardRootProps> = (props) => (
  <HoverCardPrimitive.Root gutter={8} openDelay={200} closeDelay={100} {...props} />
)

const HoverCardTrigger = HoverCardPrimitive.Trigger

const HoverCardContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, HoverCardPrimitive.HoverCardContentProps<T> & { class?: string }>
) => {
  const [local, others] = splitProps(props as HoverCardPrimitive.HoverCardContentProps & { class?: string }, ["class"])
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        class={cn(
          'absolute z-50 box-border w-(--container-popover) min-w-(--container-menu-min) origin-[var(--kb-hovercard-content-transform-origin)] rounded-8 border border-border-subtle bg-surface px-16 py-12 text-13 leading-normal text-text-primary shadow-popover outline-none focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2',
          surfacePopoverMotion,
          local.class
        )}
        {...others}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
