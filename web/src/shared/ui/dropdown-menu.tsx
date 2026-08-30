import type { Component, ComponentProps, JSX, ValidComponent } from "solid-js"
import { splitProps } from "solid-js"

import * as DropdownMenuPrimitive from "@kobalte/core/dropdown-menu"
import type { PolymorphicProps } from "@kobalte/core/polymorphic"

import { cn } from '../lib/cn';

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuPortal = DropdownMenuPrimitive.Portal
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuGroup = DropdownMenuPrimitive.Group
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenu: Component<DropdownMenuPrimitive.DropdownMenuRootProps> = (props) => {
  return <DropdownMenuPrimitive.Root gutter={4} {...props} />
}

type DropdownMenuContentProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuContentProps<T> & {
    class?: string | undefined
  }

const DropdownMenuContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DropdownMenuContentProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuContentProps, ["class"])
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        class={cn(
          "absolute z-50 flex min-w-[160px] flex-col overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 text-text-primary shadow-popover outline-none origin-[var(--kb-menu-content-transform-origin)] animate-content-hide data-[expanded]:animate-content-show",
          props.class
        )}
        {...rest}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

type DropdownMenuItemProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuItemProps<T> & {
    class?: string | undefined
  }

const DropdownMenuItem = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DropdownMenuItemProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuItemProps, ["class"])
  return (
    <DropdownMenuPrimitive.Item
      class={cn(
        "relative flex w-full min-h-32 cursor-pointer select-none items-center gap-8 rounded-6 border-0 bg-transparent px-12 text-left text-13 text-text-primary outline-none transition-colors data-[highlighted]:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 [@media(pointer:coarse)]:min-h-44 [@media(pointer:coarse)]:w-full",
        props.class
      )}
      {...rest}
    />
  )
}

const DropdownMenuShortcut: Component<ComponentProps<"span">> = (props) => {
  const [, rest] = splitProps(props, ["class"])
  return <span class={cn("ml-auto text-11 tracking-widest text-text-muted opacity-60", props.class)} {...rest} />
}

const DropdownMenuLabel: Component<ComponentProps<"div"> & { inset?: boolean }> = (props) => {
  const [, rest] = splitProps(props, ["class", "inset"])
  return (
    <div
      class={cn("px-12 py-8 text-11 font-600 text-text-muted", props.inset && "pl-32", props.class)}
      {...rest}
    />
  )
}

type DropdownMenuSeparatorProps<T extends ValidComponent = "hr"> =
  DropdownMenuPrimitive.DropdownMenuSeparatorProps<T> & {
    class?: string | undefined
  }

const DropdownMenuSeparator = <T extends ValidComponent = "hr">(
  props: PolymorphicProps<T, DropdownMenuSeparatorProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuSeparatorProps, ["class"])
  return (
    <DropdownMenuPrimitive.Separator
      class={cn("-mx-4 my-4 h-px bg-divider", props.class)}
      {...rest}
    />
  )
}

type DropdownMenuSubTriggerProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuSubTriggerProps<T> & {
    class?: string | undefined
    children?: JSX.Element
  }

const DropdownMenuSubTrigger = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DropdownMenuSubTriggerProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuSubTriggerProps, ["class", "children"])
  return (
    <DropdownMenuPrimitive.SubTrigger
      class={cn(
        "flex min-h-32 cursor-default select-none items-center rounded-6 px-12 text-13 text-text-primary outline-none data-[highlighted]:bg-hover data-[state=open]:bg-hover",
        props.class
      )}
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
    </DropdownMenuPrimitive.SubTrigger>
  )
}

type DropdownMenuSubContentProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuSubContentProps<T> & {
    class?: string | undefined
  }

const DropdownMenuSubContent = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DropdownMenuSubContentProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuSubContentProps, ["class"])
  return (
    <DropdownMenuPrimitive.SubContent
      class={cn(
        "z-50 min-w-[160px] origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 text-text-primary shadow-popover outline-none animate-content-hide data-[expanded]:animate-content-show",
        props.class
      )}
      {...rest}
    />
  )
}

type DropdownMenuCheckboxItemProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuCheckboxItemProps<T> & {
    class?: string | undefined
    children?: JSX.Element
  }

const DropdownMenuCheckboxItem = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DropdownMenuCheckboxItemProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuCheckboxItemProps, ["class", "children"])
  return (
    <DropdownMenuPrimitive.CheckboxItem
      class={cn(
        "relative flex min-h-32 cursor-default select-none items-center rounded-6 py-8 pl-32 pr-12 text-13 text-text-primary outline-none transition-colors data-[highlighted]:bg-hover focus-visible:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        props.class
      )}
      {...rest}
    >
      <span class="absolute left-12 flex size-14 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
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
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {props.children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

type DropdownMenuGroupLabelProps<T extends ValidComponent = "span"> =
  DropdownMenuPrimitive.DropdownMenuGroupLabelProps<T> & {
    class?: string | undefined
  }

const DropdownMenuGroupLabel = <T extends ValidComponent = "span">(
  props: PolymorphicProps<T, DropdownMenuGroupLabelProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuGroupLabelProps, ["class"])
  return (
    <DropdownMenuPrimitive.GroupLabel
      class={cn("px-12 py-8 text-11 font-600 text-text-muted", props.class)}
      {...rest}
    />
  )
}

type DropdownMenuRadioItemProps<T extends ValidComponent = "div"> =
  DropdownMenuPrimitive.DropdownMenuRadioItemProps<T> & {
    class?: string | undefined
    children?: JSX.Element
  }

const DropdownMenuRadioItem = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, DropdownMenuRadioItemProps<T>>
) => {
  const [, rest] = splitProps(props as DropdownMenuRadioItemProps, ["class", "children"])
  return (
    <DropdownMenuPrimitive.RadioItem
      class={cn(
        "relative flex min-h-32 cursor-default select-none items-center rounded-6 py-8 pl-32 pr-12 text-13 text-text-primary outline-none transition-colors data-[highlighted]:bg-hover focus-visible:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        props.class
      )}
      {...rest}
    >
      <span class="absolute left-12 flex size-14 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
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
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {props.children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
}
