// 签入后首次安装询问宿主：挂在 panel，与 AuthGate 兄弟，不进登录卡。

import { createEffect, onCleanup } from 'solid-js';
import { principalId } from '@/features/auth/auth-state';
import {
  acceptChromeInstallOffer,
  closeInstallOfferDialog,
  createFirstLoginInstallWatch,
  dismissInstallOfferDialog,
  installDialogKind,
  installDialogOpen,
  openInstallOfferDialog,
} from '@/features/pwa/pwa-install-prompt';
import { canAddToHomeScreen, canInstall, isStandalone } from '@/features/pwa/pwa-state';
import { PwaInstallDialog } from './PwaInstallDialog';

export function PwaInstallPrompt() {
  const watch = createFirstLoginInstallWatch({
    signedIn: () => Boolean(principalId()),
    onOffer: (kind) => openInstallOfferDialog(kind),
  });

  createEffect(() => {
    principalId();
    canInstall();
    isStandalone();
    canAddToHomeScreen();
    watch.evaluate();
  });

  createEffect(() => {
    if (!principalId() && installDialogOpen()) closeInstallOfferDialog();
  });

  onCleanup(() => watch.dispose());

  return (
    <PwaInstallDialog
      open={installDialogOpen()}
      kind={installDialogKind()}
      origin={location.origin}
      onInstall={() => acceptChromeInstallOffer()}
      onDismiss={() => {
        if (installDialogOpen()) dismissInstallOfferDialog();
      }}
    />
  );
}
