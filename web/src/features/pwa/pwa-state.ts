// PWA 安装探测：模块级信号（auth-state 模式），不走 store，不注册 Service Worker。
// startPwa() 必须在登录页已挂载时调用，才能抓住一次性 beforeinstallprompt。

import { createSignal } from 'solid-js';

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const [canInstall, setCanInstall] = createSignal(false);
const [isStandalone, setIsStandalone] = createSignal(false);
const [isIosLike, setIsIosLike] = createSignal(false);

export { canInstall, isStandalone, isIosLike };

let started = false;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let displayModeQuery: MediaQueryList | null = null;

function navigatorStandalone(): boolean {
  return 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function detectStandalone(): boolean {
  const media = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  return Boolean(media || navigatorStandalone());
}

function detectIosLike(): boolean {
  const ua = navigator.userAgent ?? '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function syncDisplayMode(): void {
  const standalone = detectStandalone();
  setIsStandalone(standalone);
  if (standalone) {
    deferredPrompt = null;
    setCanInstall(false);
  }
}

function onBeforeInstallPrompt(event: Event): void {
  event.preventDefault();
  if (detectStandalone()) return;
  deferredPrompt = event as BeforeInstallPromptEvent;
  setCanInstall(true);
}

function onAppInstalled(): void {
  deferredPrompt = null;
  setCanInstall(false);
  setIsStandalone(true);
}

function onDisplayModeChange(): void {
  syncDisplayMode();
}

/** 捕获一次性 beforeinstallprompt；重复调用是空操作。 */
export function startPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  setIsIosLike(detectIosLike());
  syncDisplayMode();
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
  if (typeof window.matchMedia === 'function') {
    displayModeQuery = window.matchMedia('(display-mode: standalone)');
    displayModeQuery.addEventListener('change', onDisplayModeChange);
  }
}

export async function promptInstall(): Promise<void> {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  deferredPrompt = null;
  setCanInstall(false);
}

/** 测试夹具：直接写入信号，不经过浏览器事件。 */
export function installPwaSignals(next: {
  canInstall?: boolean;
  isStandalone?: boolean;
  isIosLike?: boolean;
}): void {
  if (next.canInstall !== undefined) setCanInstall(next.canInstall);
  if (next.isStandalone !== undefined) setIsStandalone(next.isStandalone);
  if (next.isIosLike !== undefined) setIsIosLike(next.isIosLike);
}

/** 测试夹具：卸掉监听并恢复默认信号。 */
export function resetPwaForTests(): void {
  if (typeof window !== 'undefined' && started) {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.removeEventListener('appinstalled', onAppInstalled);
    displayModeQuery?.removeEventListener('change', onDisplayModeChange);
  }
  started = false;
  deferredPrompt = null;
  displayModeQuery = null;
  setCanInstall(false);
  setIsStandalone(false);
  setIsIosLike(false);
}
