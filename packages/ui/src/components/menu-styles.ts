import { menuSurfaceMotion } from '../lib/overlay-motion';

/** Shared menu surface recipes for dropdown and context menus. */

export const menuContentClass =
  `absolute z-50 flex min-w-(--container-menu-min) flex-col overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 text-text-primary shadow-popover outline-none origin-[var(--kb-menu-content-transform-origin)] ${menuSurfaceMotion}`

export const menuItemClass =
  "relative flex w-full min-h-36 cursor-pointer select-none items-center gap-8 rounded-6 border-0 bg-transparent px-12 text-left text-13 text-text-primary outline-none transition-colors data-[highlighted]:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 [@media(pointer:coarse)]:min-h-44 [@media(pointer:coarse)]:w-full"

export const menuShortcutClass = "ml-auto text-11 tracking-widest text-text-muted opacity-60"

export const menuLabelClass = "px-12 py-8 text-11 font-600 text-text-muted"

export const menuSeparatorClass = "-mx-4 my-4 h-px bg-divider"

export const menuSubTriggerClass =
  "flex min-h-36 cursor-default select-none items-center rounded-6 px-12 text-13 text-text-primary outline-none data-[highlighted]:bg-hover data-[state=open]:bg-hover"

export const menuSubContentClass =
  `z-50 min-w-(--container-menu-min) origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-8 border border-border-subtle bg-surface p-4 text-text-primary shadow-popover outline-none ${menuSurfaceMotion}`

export const menuCheckboxItemClass =
  "relative flex min-h-36 cursor-default select-none items-center rounded-6 py-8 pl-32 pr-12 text-13 text-text-primary outline-none transition-colors data-[highlighted]:bg-hover focus-visible:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45"

export const menuGroupLabelClass = "px-12 py-8 text-11 font-600 text-text-muted"

export const menuRadioItemClass =
  "relative flex min-h-36 cursor-default select-none items-center rounded-6 py-8 pl-32 pr-12 text-13 text-text-primary outline-none transition-colors data-[highlighted]:bg-hover focus-visible:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-45"

export const menuItemIndicatorClass = "absolute left-12 flex size-14 items-center justify-center"

/** 水平 menubar 容器：桌面应用式顶栏菜单。 */
export const menubarClass =
  "flex h-36 items-center gap-4 rounded-md border border-border-subtle bg-surface p-4 shadow-popover"

/** Menubar 触发器：File / Edit / View 等顶栏项。 */
export const menubarTriggerClass =
  "flex cursor-pointer select-none items-center rounded-6 border-0 bg-transparent px-8 py-4 text-13 font-medium text-text-primary outline-none transition-colors data-[highlighted]:bg-hover data-[state=open]:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-45"

/** Navigation menu 根容器。 */
export const navigationMenuClass =
  "group/navigation-menu relative flex max-w-max flex-1 items-center justify-center"

/** Navigation menu 列表行内布局（由 Kobalte Root ul 承载）。 */
export const navigationMenuListClass =
  "group flex flex-1 list-none items-center justify-center gap-4"

/** Navigation menu 下拉面板内容区（挂载在 Viewport 内，勿 Portal）。 */
export const navigationMenuContentClass =
  "absolute top-0 left-0 w-max min-w-full p-4 outline-none"

/** Navigation menu 视口容器（尺寸由 Kobalte CSS 变量驱动，见 extra.css）。 */
export const navigationMenuViewportClass =
  `ui-navigation-menu-viewport relative mt-6 w-full overflow-hidden rounded-8 border border-border-subtle bg-surface text-text-primary shadow-popover outline-none ${menuSurfaceMotion}`

/** Navigation menu 内链卡片。 */
export const navigationMenuLinkClass =
  "block rounded-6 px-12 py-8 text-13 leading-normal no-underline transition-colors outline-none hover:bg-hover hover:text-text-primary focus-visible:bg-hover focus-visible:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2 data-[active=true]:bg-hover data-[active=true]:font-medium data-[active=true]:text-text-primary"

/** Navigation menu 展开指示箭头容器。 */
export const navigationMenuIndicatorClass =
  "top-full z-1 flex h-6 items-end justify-center overflow-hidden data-[closed]:opacity-0 data-[expanded]:opacity-100 transition-opacity"
