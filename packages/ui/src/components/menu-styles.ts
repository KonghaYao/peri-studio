/** Shared menu surface recipes for dropdown and context menus. */

export const menuContentClass =
  "absolute z-50 flex min-w-(--container-menu-min) flex-col overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 text-text-primary shadow-popover outline-none origin-[var(--kb-menu-content-transform-origin)] animate-content-hide data-[expanded]:animate-content-show"

export const menuItemClass =
  "relative flex w-full min-h-32 cursor-pointer select-none items-center gap-8 rounded-6 border-0 bg-transparent px-12 text-left text-13 text-text-primary outline-none transition-colors data-[highlighted]:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 [@media(pointer:coarse)]:min-h-44 [@media(pointer:coarse)]:w-full"

export const menuShortcutClass = "ml-auto text-11 tracking-widest text-text-muted opacity-60"

export const menuLabelClass = "px-12 py-8 text-11 font-600 text-text-muted"

export const menuSeparatorClass = "-mx-4 my-4 h-px bg-divider"

export const menuSubTriggerClass =
  "flex min-h-32 cursor-default select-none items-center rounded-6 px-12 text-13 text-text-primary outline-none data-[highlighted]:bg-hover data-[state=open]:bg-hover"

export const menuSubContentClass =
  "z-50 min-w-(--container-menu-min) origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 text-text-primary shadow-popover outline-none animate-content-hide data-[expanded]:animate-content-show"

export const menuCheckboxItemClass =
  "relative flex min-h-32 cursor-default select-none items-center rounded-6 py-8 pl-32 pr-12 text-13 text-text-primary outline-none transition-colors data-[highlighted]:bg-hover focus-visible:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45"

export const menuGroupLabelClass = "px-12 py-8 text-11 font-600 text-text-muted"

export const menuRadioItemClass =
  "relative flex min-h-32 cursor-default select-none items-center rounded-6 py-8 pl-32 pr-12 text-13 text-text-primary outline-none transition-colors data-[highlighted]:bg-hover focus-visible:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45"

export const menuItemIndicatorClass = "absolute left-12 flex size-14 items-center justify-center"
