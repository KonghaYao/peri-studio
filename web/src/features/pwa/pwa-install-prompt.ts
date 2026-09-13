// 首次登录安装询问：origin 级「已问过」持久化 + 齿轮菜单可见性。
// 不进 store，不写 token；localStorage 仅存 asked，不是凭据。

import { createSignal } from 'solid-js';
import {
  canAddToHomeScreen,
  canInstall,
  installBusy,
  isStandalone,
  promptInstall,
} from './pwa-state';

export const PWA_INSTALL_PROMPT_STORAGE_KEY = 'peri_studio:pwa-install-prompt';
export const PWA_INSTALL_PROMPT_ASKED_VALUE = 'asked';
/** BIP 常在登录页就到达；签入后再等一小段，超时则跳过，避免永远挂起。 */
export const FIRST_LOGIN_INSTALL_WAIT_MS = 2_000;

export type PwaInstallOfferKind = 'chrome' | 'a2hs';

const [installDialogOpen, setInstallDialogOpen] = createSignal(false);
const [installDialogKind, setInstallDialogKind] = createSignal<PwaInstallOfferKind>('chrome');

export { installDialogOpen, installDialogKind };

/** standalone 与 window-controls-overlay 都算已安装（见 pwa-state）。 */
export function canOfferInstall(): boolean {
  if (isStandalone()) return false;
  return canInstall() || installBusy() || canAddToHomeScreen();
}

export function resolveInstallOfferKind(): PwaInstallOfferKind | null {
  if (isStandalone()) return null;
  if (canInstall() || installBusy()) return 'chrome';
  if (canAddToHomeScreen()) return 'a2hs';
  return null;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasAskedInstallPrompt(source: Pick<Storage, 'getItem'> | null = storage()): boolean {
  if (!source) return false;
  try {
    return source.getItem(PWA_INSTALL_PROMPT_STORAGE_KEY) === PWA_INSTALL_PROMPT_ASKED_VALUE;
  } catch {
    return false;
  }
}

export function recordInstallPromptAsked(target: Pick<Storage, 'setItem'> | null = storage()): void {
  if (!target) return;
  try {
    target.setItem(PWA_INSTALL_PROMPT_STORAGE_KEY, PWA_INSTALL_PROMPT_ASKED_VALUE);
  } catch {
    // 隐私模式等不可写时静默降级：本会话不再追问即可。
  }
}

export type FirstLoginInstallDecision =
  | { show: true; kind: PwaInstallOfferKind }
  | { show: false; reason: 'not-signed-in' | 'standalone' | 'dismissed' | 'unavailable' | 'waiting' };

/** 纯函数：首次登录弹窗是否现在该出现（等待由 elapsed 表达）。 */
export function decideFirstLoginInstallPrompt(input: {
  signedIn: boolean;
  canInstall: boolean;
  canAddToHomeScreen: boolean;
  isStandalone: boolean;
  dismissed: boolean;
  waitElapsedMs: number;
  waitMs?: number;
}): FirstLoginInstallDecision {
  if (!input.signedIn) return { show: false, reason: 'not-signed-in' };
  if (input.isStandalone) return { show: false, reason: 'standalone' };
  if (input.dismissed) return { show: false, reason: 'dismissed' };
  if (input.canInstall) return { show: true, kind: 'chrome' };
  if (input.canAddToHomeScreen) return { show: true, kind: 'a2hs' };
  if (input.waitElapsedMs < (input.waitMs ?? FIRST_LOGIN_INSTALL_WAIT_MS)) {
    return { show: false, reason: 'waiting' };
  }
  return { show: false, reason: 'unavailable' };
}

export function openInstallOfferDialog(kind: PwaInstallOfferKind): void {
  setInstallDialogKind(kind);
  setInstallDialogOpen(true);
}

export function closeInstallOfferDialog(): void {
  setInstallDialogOpen(false);
}

export function dismissInstallOfferDialog(): void {
  recordInstallPromptAsked();
  setInstallDialogOpen(false);
}

/** Chrome：走系统 prompt；iOS：打开 A2HS 说明，不假装能 prompt。 */
export function handleInstallMenuAction(): void {
  if (isStandalone() || installBusy()) return;
  recordInstallPromptAsked();
  if (canInstall()) {
    void promptInstall();
    return;
  }
  if (canAddToHomeScreen()) openInstallOfferDialog('a2hs');
}

export function acceptChromeInstallOffer(): void {
  recordInstallPromptAsked();
  setInstallDialogOpen(false);
  void promptInstall();
}

export function createFirstLoginInstallWatch(deps: {
  signedIn: () => boolean;
  onOffer: (kind: PwaInstallOfferKind) => void;
  schedule?: (callback: () => void, ms: number) => number;
  cancel?: (id: number) => void;
  waitMs?: number;
}): { evaluate: () => void; dispose: () => void } {
  let timer: number | undefined;
  let settled = false;
  const schedule = deps.schedule ?? ((callback, ms) => window.setTimeout(callback, ms) as unknown as number);
  const cancel = deps.cancel ?? ((id) => window.clearTimeout(id));
  const waitMs = deps.waitMs ?? FIRST_LOGIN_INSTALL_WAIT_MS;

  const clearTimer = () => {
    if (timer === undefined) return;
    cancel(timer);
    timer = undefined;
  };

  const settleOffer = (kind: PwaInstallOfferKind) => {
    settled = true;
    clearTimer();
    deps.onOffer(kind);
  };

  return {
    evaluate() {
      if (settled) return;
      if (!deps.signedIn()) {
        clearTimer();
        return;
      }
      const decision = decideFirstLoginInstallPrompt({
        signedIn: true,
        canInstall: canInstall(),
        canAddToHomeScreen: canAddToHomeScreen(),
        isStandalone: isStandalone(),
        dismissed: hasAskedInstallPrompt(),
        waitElapsedMs: 0,
        waitMs,
      });
      if (decision.show) {
        settleOffer(decision.kind);
        return;
      }
      if (decision.reason === 'standalone' || decision.reason === 'dismissed') {
        settled = true;
        clearTimer();
        return;
      }
      if (decision.reason !== 'waiting' || timer !== undefined) return;
      timer = schedule(() => {
        timer = undefined;
        settled = true;
        if (!deps.signedIn() || isStandalone() || hasAskedInstallPrompt()) return;
        if (canInstall()) {
          settled = false;
          settleOffer('chrome');
        }
      }, waitMs);
    },
    dispose() {
      clearTimer();
    },
  };
}

/** 测试夹具：清弹窗信号与 origin 询问记录。 */
export function resetPwaInstallPromptForTests(): void {
  setInstallDialogOpen(false);
  setInstallDialogKind('chrome');
  try {
    window.localStorage.removeItem(PWA_INSTALL_PROMPT_STORAGE_KEY);
  } catch {
    // jsdom 存储可用；忽略不可写环境。
  }
}
