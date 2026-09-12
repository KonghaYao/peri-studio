import type { Component, JSX, ValidComponent } from "solid-js"
import { splitProps } from "solid-js"
import * as HoverCardPrimitive from "@kobalte/core/hover-card"
import type { PolymorphicProps } from "@kobalte/core/polymorphic"
import { FloatingSurface } from "./FloatingSurface"
import { cn } from "../lib/cn"
import { floatingPositionedShellClass, surfacePopoverMotion } from "../lib/overlay-motion"

const HoverCard: Component<HoverCardPrimitive.HoverCardRootProps> = (props) => (
  <HoverCardPrimitive.Root gutter={8} openDelay={200} closeDelay={100} {...props} />
)

const HoverCardTrigger = HoverCardPrimitive.Trigger

const HoverCardContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, HoverCardPrimitive.HoverCardContentProps<T> & { class?: string; children?: JSX.Element }>
) => {
  const [local, others] = splitProps(props as HoverCardPrimitive.HoverCardContentProps & { class?: string; children?: JSX.Element }, ["class", "children"])
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content class={floatingPositionedShellClass} {...others}>
        <FloatingSurface
          class={cn(
            'box-border w-(--container-popover) min-w-(--container-menu-min) origin-[var(--kb-hovercard-content-transform-origin)] rounded-8 border border-border-subtle bg-surface px-16 py-12 text-13 leading-normal text-text-primary shadow-popover outline-none focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2',
            surfacePopoverMotion,
            local.class,
          )}
        >
          {local.children}
        </FloatingSurface>
      </HoverCardPrimitive.Content>
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
