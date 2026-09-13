// 首次登录 / iOS A2HS 安装说明：@peri/ui Dialog，不用 Toast。
// Chrome 走 promptInstall；iOS 只解释 Share，不提供空 Install。

import { Show } from 'solid-js';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@peri/ui';
import { installBusy } from '@/features/pwa/pwa-state';
import type { PwaInstallOfferKind } from '@/features/pwa/pwa-install-prompt';

export function PwaInstallDialog(props: {
  open: boolean;
  kind: PwaInstallOfferKind;
  origin: string;
  busy?: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  const chrome = () => props.kind === 'chrome';
  const busy = () => props.busy ?? installBusy();

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) props.onDismiss(); }}
    >
      <DialogContent data-testid="pwa-install-dialog">
        <DialogHeader>
          <DialogTitle>Install Peri Studio?</DialogTitle>
        </DialogHeader>
        <div class="px-20 py-16">
          <DialogDescription class="m-0 text-13 leading-155 text-text-secondary">
            <Show
              when={chrome()}
              fallback={(
                <>
                  Open Share, then Add to Home Screen. Add a shortcut on this computer for {props.origin}.
                  Peri Studio needs this local server. The window is useless if the server is stopped.
                  A Home Screen app uses its own storage and may ask you to sign in again.
                </>
              )}
            >
              Add a shortcut on this computer for {props.origin}. Peri Studio needs this local server.
              The window is useless if the server is stopped.
            </Show>
          </DialogDescription>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="compact" onClick={props.onDismiss}>
            Not now
          </Button>
          <Show when={chrome()}>
            <Button
              variant="primary"
              size="compact"
              busy={busy()}
              disabled={busy()}
              onClick={props.onInstall}
            >
              Install
            </Button>
          </Show>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
