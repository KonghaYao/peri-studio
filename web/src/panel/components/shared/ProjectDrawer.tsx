import { Show, type JSX } from 'solid-js';
import { Dialog, DialogContent, DialogTitle } from '../../../components/ui';

interface ProjectDrawerProps {
  open: boolean;
  modal: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
  ref?: (element: HTMLElement) => void;
}

const drawerClass = 'project-drawer min-w-0 border-r border-border-subtle bg-sidebar-bg max-desk:fixed max-desk:inset-y-0 max-desk:left-0 max-desk:z-40 max-desk:w-(--container-drawer)';

/** Product navigation: structural on desktop and a Kobalte modal dialog on compact viewports. */
export function ProjectDrawer(props: ProjectDrawerProps) {
  return <Show when={props.modal} fallback={
    <aside ref={props.ref} class={drawerClass}>{props.children}</aside>
  }>
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        ref={props.ref}
        class={`${drawerClass} ${props.open ? 'is-open' : ''}`}
      >
        <DialogTitle class="sr-only">Projects &amp; Sessions</DialogTitle>
        {props.children}
      </DialogContent>
    </Dialog>
  </Show>;
}
