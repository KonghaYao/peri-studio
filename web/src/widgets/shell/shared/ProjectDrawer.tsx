import { Show, type JSX } from 'solid-js';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui';
import { cn } from '../../../lib/cn';

interface ProjectDrawerProps {
  open: boolean;
  modal: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
  ref?: (element: HTMLElement) => void;
}

const drawerPanelClass =
  'project-drawer min-h-0 min-w-0 overflow-hidden border-r border-border-subtle bg-sidebar-bg max-desk:fixed max-desk:inset-y-0 max-desk:left-0 max-desk:top-0 max-desk:z-61 max-desk:h-dvh max-desk:w-(--container-drawer) max-desk:max-h-none max-desk:translate-y-0 max-desk:rounded-none max-desk:border-t-0 max-desk:shadow-none max-desk:transition-transform max-desk:duration-200';

/** Product navigation: structural on desktop and a Kobalte modal dialog on compact viewports. */
export function ProjectDrawer(props: ProjectDrawerProps) {
  const compactPanelClass = () => cn(
    drawerPanelClass,
    props.open ? 'max-desk:translate-x-0' : 'max-desk:-translate-x-full',
  );

  return <Show when={props.modal} fallback={
    <aside ref={props.ref} class={drawerPanelClass}>{props.children}</aside>
  }>
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        ref={props.ref}
        class={compactPanelClass()}
      >
        <DialogTitle class="sr-only">Projects &amp; Sessions</DialogTitle>
        {props.children}
      </DialogContent>
    </Dialog>
  </Show>;
}
