import { For, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../Dialog';
import { Kbd } from '../Kbd';

export type ShortcutEntry = {
  keys: string[];
  label: string;
};

export type ShortcutsDialogShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: ShortcutEntry[];
  title?: string;
  class?: string;
  'data-testid'?: string;
};

/** T3 · 键盘快捷键参考弹窗；无全局监听，由 T4 绑定 `bindShortcutsHelpHotkey`。 */
export const ShortcutsDialogShell: Component<ShortcutsDialogShellProps> = (props) => {
  const [local, rest] = splitProps(props, ['open', 'onOpenChange', 'shortcuts', 'title', 'class']);

  return (
    <Dialog open={local.open} onOpenChange={local.onOpenChange}>
      <DialogContent {...rest} size="default" class={cn('ui-shortcuts-dialog sm:max-w-360', local.class)}>
        <DialogHeader>
          <DialogTitle>{local.title ?? 'Keyboard shortcuts'}</DialogTitle>
          <DialogDescription class="sr-only">Reference of global keyboard shortcuts.</DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <For each={local.shortcuts}>
            {(entry) => (
              <div class="flex items-center justify-between rounded-6 px-8 py-6 text-12">
                <span class="text-content-secondary">{entry.label}</span>
                <span class="flex items-center gap-4">
                  <For each={entry.keys}>
                    {(key) => <Kbd>{key}</Kbd>}
                  </For>
                </span>
              </div>
            )}
          </For>
        </div>
      </DialogContent>
    </Dialog>
  );
};
