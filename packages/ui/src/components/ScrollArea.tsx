import type { Component, ComponentProps } from "solid-js"
import { splitProps } from "solid-js"
import { cn } from "../lib/cn"

const ScrollArea: Component<ComponentProps<"div">> = (props) => {
  const [, rest] = splitProps(props, ["class"])
  return <div class={cn("relative overflow-hidden", props.class)} {...rest} />
}

const ScrollAreaViewport: Component<ComponentProps<"div">> = (props) => {
  const [, rest] = splitProps(props, ["class"])
  return <div class={cn("size-full overflow-auto ui-scrollbar", props.class)} {...rest} />
}

type ScrollAreaScrollbarProps = ComponentProps<"div"> & {
  orientation?: "vertical" | "horizontal"
}

const ScrollAreaScrollbar: Component<ScrollAreaScrollbarProps> = (props) => {
  const [, rest] = splitProps(props, ["class", "orientation"])
  const orientation = props.orientation ?? "vertical"
  return (
    <div
      data-orientation={orientation}
      class={cn(
        "flex touch-none select-none transition-colors",
        orientation === "vertical" && "h-full w-6 border-l border-l-transparent p-px",
        orientation === "horizontal" && "h-6 w-full flex-col border-t border-t-transparent p-px",
        props.class
      )}
      {...rest}
    />
  )
}

const ScrollAreaThumb: Component<ComponentProps<"div">> = (props) => {
  const [, rest] = splitProps(props, ["class"])
  return <div class={cn("relative flex-1 rounded-full bg-scrollbar-thumb", props.class)} {...rest} />
}

export { ScrollArea, ScrollAreaViewport, ScrollAreaScrollbar, ScrollAreaThumb }
