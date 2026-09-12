import { cn } from '../../lib/cn';

/** 保留 extra.css :focus-within outline（无 bracket 等价）。 */
export const terminalDockViewportFocusClass = 'ui-terminal-dock-viewport';

export const terminalDockShellClass = cn(
  'flex min-h-0 min-w-0 flex-1 flex-col bg-terminal-dock-surface',
);

export const terminalDockHeaderClass = cn(
  'flex h-36 min-w-0 shrink-0 items-center gap-8 overflow-hidden whitespace-nowrap border-b border-border-subtle px-8',
);

export const terminalDockTitleClass = 'flex min-w-0 items-center gap-6 overflow-hidden';

export const terminalDockSpacerClass = 'min-w-0 flex-1';

export const terminalDockHeaderActionsClass = 'flex shrink-0 items-center gap-6';

export const terminalDockViewportClass = cn(
  terminalDockViewportFocusClass,
  'flex min-h-0 flex-1 flex-col p-8',
);

export const terminalDockViewportCollapsedClass = 'hidden';

export const terminalDockFooterClass = cn(
  'flex h-36 min-w-0 shrink-0 items-center gap-8 overflow-hidden whitespace-nowrap border-t border-border-subtle px-8 text-11 text-content-muted',
);

export const terminalDockStatusClass = 'shrink-0';
