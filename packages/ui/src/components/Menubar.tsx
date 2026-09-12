import type { Component, ComponentProps, JSX, ValidComponent } from "solid-js"
import { splitProps } from "solid-js"

import * as MenubarPrimitive from "@kobalte/core/menubar"
import type { PolymorphicProps } from "@kobalte/core/polymorphic"

import { cn } from "../lib/cn"
import {
  menubarClass,
  menubarTriggerClass,
  menuCheckboxItemClass,
  menuContentClass,
  menuItemClass,
  menuItemIndicatorClass,
  menuRadioItemClass,
  menuSeparatorClass,
  menuShortcutClass,
  menuSubContentClass,
  menuSubTriggerClass,
} from "./menu-styles"

const MenubarMenu = MenubarPrimitive.Menu
const MenubarSub = MenubarPrimitive.Sub
const MenubarRadioGroup = MenubarPrimitive.RadioGroup

type MenubarProps<T extends ValidComponent = "div"> =
  MenubarPrimitive.MenubarRootProps<T> & {
    class?: string | undefined
  }

/** 水平 menubar 根容器。 */
const Menubar = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, MenubarProps<T>>
) => {
  const [, rest] = splitProps(props as MenubarProps, ["class"])
  return (
    <MenubarPrimitive.Root
      class={cn(menubarClass, props.class)}
      {...rest}
    />
  )
}

type MenubarTriggerProps<T extends ValidComponent = "button"> =
  MenubarPrimitive.MenubarTriggerProps<T> & {
    class?: string | undefined
  }

const MenubarTrigger = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, MenubarTriggerProps<T>>
) => {
  const [, rest] = splitProps(props as MenubarTriggerProps, ["class"])
  return (
    <MenubarPrimitive.Trigger
      class={cn(menubarTriggerClass, props.class)}
      {...rest}
    />
  )
}

type MenubarContentProps<T extends ValidComponent = "div"> =
  MenubarPrimitive.MenubarContentProps<T> & {
    class?: string | undefined
    align?: "start" | "center" | "end"
    alignOffset?: number
    sideOffset?: number
  }

const MenubarContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, MenubarContentProps<T>>
) => {
  const [local, rest] = splitProps(props as MenubarContentProps, [
    "class",
    "align",
    "alignOffset",
    "sideOffset",
  ])
  return (
    <MenubarPrimitive.Portal>
      <MenubarPrimitive.Content
        align={local.align ?? "start"}
        alignOffset={local.alignOffset ?? -4}
        sideOffset={local.sideOffset ?? 8}
        class={cn(menuContentClass, local.class)}
        {...rest}
      />
    </MenubarPrimitive.Portal>
  )
}

type MenubarItemProps<T extends ValidComponent = "div"> =
  MenubarPrimitive.MenubarItemProps<T> & {
    class?: string | undefined
  }

const MenubarItem = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, MenubarItemProps<T>>
) => {
  const [, rest] = splitProps(props as MenubarItemProps, ["class"])
  return (
    <MenubarPrimitive.Item
      class={cn(menuItemClass, props.class)}
      {...rest}
    />
  )
}

const MenubarShortcut: Component<ComponentProps<"span">> = (props) => {
  const [, rest] = splitProps(props, ["class"])
  return <span class={cn(menuShortcutClass, props.class)} {...rest} />
}

type MenubarSeparatorProps<T extends ValidComponent = "hr"> =
  MenubarPrimitive.MenubarSeparatorProps<T> & {
    class?: string | undefined
  }

const MenubarSeparator = <T extends ValidComponent = "hr">(
  props: PolymorphicProps<T, MenubarSeparatorProps<T>>
) => {
  const [, rest] = splitProps(props as MenubarSeparatorProps, ["class"])
  return (
    <MenubarPrimitive.Separator
      class={cn(menuSeparatorClass, props.class)}
      {...rest}
    />
  )
}

type MenubarSubTriggerProps<T extends ValidComponent = "div"> =
  MenubarPrimitive.MenubarSubTriggerProps<T> & {
    class?: string | undefined
    children?: JSX.Element
  }

const MenubarSubTrigger = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, MenubarSubTriggerProps<T>>
) => {
  const [, rest] = splitProps(props as MenubarSubTriggerProps, ["class", "children"])
  return (
    <MenubarPrimitive.SubTrigger
      class={cn(menuSubTriggerClass, props.class)}
      {...rest}
    >
      {props.children}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="ml-auto size-16"
      >
        <path d="M9 6l6 6l-6 6" />
      </svg>
    </MenubarPrimitive.SubTrigger>
  )
}

type MenubarSubContentProps<T extends ValidComponent = "div"> =
  MenubarPrimitive.MenubarSubContentProps<T> & {
    class?: string | undefined
  }

const MenubarSubContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, MenubarSubContentProps<T>>
) => {
  const [, rest] = splitProps(props as MenubarSubContentProps, ["class"])
  return (
    <MenubarPrimitive.SubContent
      class={cn(menuSubContentClass, props.class)}
      {...rest}
    />
  )
}

type MenubarCheckboxItemProps<T extends ValidComponent = "div"> =
  MenubarPrimitive.MenubarCheckboxItemProps<T> & {
    class?: string | undefined
    children?: JSX.Element
  }

const MenubarCheckboxItem = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, MenubarCheckboxItemProps<T>>
) => {
  const [, rest] = splitProps(props as MenubarCheckboxItemProps, ["class", "children"])
  return (
    <MenubarPrimitive.CheckboxItem
      class={cn(menuCheckboxItemClass, props.class)}
      {...rest}
    >
      <span class={menuItemIndicatorClass}>
        <MenubarPrimitive.ItemIndicator>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="size-16"
          >
            <path d="M5 12l5 5l10 -10" />
          </svg>
        </MenubarPrimitive.ItemIndicator>
      </span>
      {props.children}
    </MenubarPrimitive.CheckboxItem>
  )
}

type MenubarRadioItemProps<T extends ValidComponent = "div"> =
  MenubarPrimitive.MenubarRadioItemProps<T> & {
    class?: string | undefined
    children?: JSX.Element
  }

const MenubarRadioItem = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, MenubarRadioItemProps<T>>
) => {
  const [, rest] = splitProps(props as MenubarRadioItemProps, ["class", "children"])
  return (
    <MenubarPrimitive.RadioItem
      class={cn(menuRadioItemClass, props.class)}
      {...rest}
    >
      <span class={menuItemIndicatorClass}>
        <MenubarPrimitive.ItemIndicator>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="size-8 fill-current"
          >
            <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
          </svg>
        </MenubarPrimitive.ItemIndicator>
      </span>
      {props.children}
    </MenubarPrimitive.RadioItem>
  )
}

export {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
}
