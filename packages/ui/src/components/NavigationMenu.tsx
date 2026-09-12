import { cva } from "class-variance-authority"
import type { Component, ComponentProps, JSX, ParentProps, ValidComponent } from "solid-js"
import { splitProps } from "solid-js"
import { ChevronDown } from "lucide-solid"

import * as NavigationMenuPrimitive from "@kobalte/core/navigation-menu"
import type { PolymorphicProps } from "@kobalte/core/polymorphic"

import { cn } from "../lib/cn"
import {
  navigationMenuClass,
  navigationMenuContentClass,
  navigationMenuIndicatorClass,
  navigationMenuLinkClass,
  navigationMenuListClass,
  navigationMenuViewportClass,
} from "./menu-styles"

/** Navigation menu 触发器样式（shadcn parity，可复用于链接态顶栏项）。 */
export const navigationMenuTriggerStyle = cva(
  "group inline-flex h-36 w-max items-center justify-center rounded-md border-0 bg-surface px-16 py-8 text-13 font-medium text-text-primary transition-colors outline-none hover:bg-hover hover:text-text-primary focus-visible:bg-hover focus-visible:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-45 data-[state=open]:bg-hover data-[state=open]:text-text-primary"
)

type NavigationMenuProps<T extends ValidComponent = "ul"> =
  NavigationMenuPrimitive.NavigationMenuRootProps<T> & {
    class?: string | undefined
    children?: JSX.Element
    /** 是否在根节点末尾渲染共享 Viewport（默认 true，对齐 shadcn）。 */
    viewport?: boolean
  }

/** 顶栏导航根容器；Kobalte Root 本身为 ul 列表。 */
const NavigationMenu = <T extends ValidComponent = "ul">(
  props: PolymorphicProps<T, NavigationMenuProps<T>>
) => {
  const merged = props as NavigationMenuProps
  const [local, rest] = splitProps(merged, ["class", "viewport", "children"])
  return (
    <NavigationMenuPrimitive.Root
      class={cn(navigationMenuClass, navigationMenuListClass, local.class)}
      {...rest}
    >
      {local.children}
      {local.viewport !== false ? <NavigationMenuViewport /> : null}
    </NavigationMenuPrimitive.Root>
  )
}

type NavigationMenuListProps = ParentProps<{
  class?: string | undefined
}>

/**
 * shadcn API 对齐用列表分组：Kobalte Root 已渲染 ul，此处仅透传子节点。
 * 列表布局类名请加在 NavigationMenu 根上。
 */
const NavigationMenuList: Component<NavigationMenuListProps> = (props) => {
  return <>{props.children}</>
}

const NavigationMenuItem = NavigationMenuPrimitive.Menu

type NavigationMenuTriggerProps<T extends ValidComponent = "button"> =
  NavigationMenuPrimitive.NavigationMenuTriggerProps<T> & {
    class?: string | undefined
    children?: JSX.Element
  }

const NavigationMenuTrigger = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, NavigationMenuTriggerProps<T>>
) => {
  const [local, rest] = splitProps(props as NavigationMenuTriggerProps, ["class", "children"])
  return (
    <NavigationMenuPrimitive.Trigger
      class={cn(navigationMenuTriggerStyle(), "group", local.class)}
      {...rest}
    >
      {local.children}
      <ChevronDown
        class="relative top-px ml-4 size-16 transition duration-200 group-data-[state=open]:rotate-180"
        aria-hidden="true"
      />
    </NavigationMenuPrimitive.Trigger>
  )
}

type NavigationMenuContentProps<T extends ValidComponent = "ul"> =
  NavigationMenuPrimitive.NavigationMenuContentProps<T> & {
    class?: string | undefined
  }

const NavigationMenuContent = <T extends ValidComponent = "ul">(
  props: PolymorphicProps<T, NavigationMenuContentProps<T>>
) => {
  const [, rest] = splitProps(props as NavigationMenuContentProps, ["class"])
  return (
    <NavigationMenuPrimitive.Content
      class={cn(navigationMenuContentClass, props.class)}
      {...rest}
    />
  )
}

type NavigationMenuLinkProps = ComponentProps<"a"> & {
  active?: boolean
}

const NavigationMenuLink: Component<NavigationMenuLinkProps> = (props) => {
  const [local, rest] = splitProps(props, ["class", "active"])
  return (
    <a
      data-active={local.active ? true : undefined}
      class={cn(navigationMenuLinkClass, local.class)}
      {...rest}
    />
  )
}

type NavigationMenuIndicatorProps = ComponentProps<"div">

const NavigationMenuIndicator: Component<NavigationMenuIndicatorProps> = (props) => {
  const [, rest] = splitProps(props, ["class"])
  return (
    <div
      class={cn(navigationMenuIndicatorClass, props.class)}
      {...rest}
    >
      <div class="relative top-60 size-8 rotate-45 rounded-tl-2 bg-border-subtle shadow-popover" />
    </div>
  )
}

type NavigationMenuViewportProps<T extends ValidComponent = "li"> =
  NavigationMenuPrimitive.NavigationMenuViewportProps<T> & {
    class?: string | undefined
  }

const NavigationMenuViewport = <T extends ValidComponent = "li">(
  props: PolymorphicProps<T, NavigationMenuViewportProps<T>>
) => {
  const [, rest] = splitProps(props as NavigationMenuViewportProps, ["class"])
  return (
    <NavigationMenuPrimitive.Viewport
      class={cn(navigationMenuViewportClass, props.class)}
      {...rest}
    />
  )
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuTrigger,
  NavigationMenuContent,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
}
