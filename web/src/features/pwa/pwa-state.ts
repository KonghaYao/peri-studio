// PWA 安装探测：模块级信号（auth-state 模式），不走 store，不注册 Service Worker。
// startPwa() 必须在登录页已挂载时调用，才能抓住一次性 beforeinstallprompt。

import { createSignal } from 'solid-js';

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export type BrowserInstallKind = 'installed' | 'install' | 'a2hs' | 'cannot-install';

const [canInstall, setCanInstall] = createSignal(false);
const [isStandalone, setIsStandalone] = createSignal(false);
const [isIosLike, setIsIosLike] = createSignal(false);
const [isLoopbackHost, setIsLoopbackHost] = createSignal(false);
const [isSecureContext, setIsSecureContext] = createSignal(false);
const [installBusy, setInstallBusy] = createSignal(false);

export { canInstall, isStandalone, isIosLike, isLoopbackHost, isSecureContext, installBusy };

/** iOS A2HS 只在 loopback 安全上下文提示；不得给 LAN HTTP 发明 127.0.0.1 快捷方式。 */
export function canAddToHomeScreen(): boolean {
  return isIosLike() && isSecureContext() && isLoopbackHost();
}

/** 互斥安装态：Installed | Install | iOS A2HS | cannot install。 */
export function browserInstallKind(): BrowserInstallKind {
  if (isStandalone()) return 'installed';
  if (canInstall() || installBusy()) return 'install';
  if (canAddToHomeScreen()) return 'a2hs';
  return 'cannot-install';
}

/** 127.0.0.1 / localhost / ::1（含 `[::1]` 写法）。 */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

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

function detectLoopbackHost(): boolean {
  return typeof location !== 'undefined' && isLoopbackHostname(location.hostname);
}

function detectSecureContext(): boolean {
  return typeof globalThis.isSecureContext === 'boolean' && globalThis.isSecureContext;
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
  setIsLoopbackHost(detectLoopbackHost());
  setIsSecureContext(detectSecureContext());
  syncDisplayMode();
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onAppInstalled);
  if (typeof window.matchMedia === 'function') {
    displayModeQuery = window.matchMedia('(display-mode: standalone)');
    displayModeQuery.addEventListener('change', onDisplayModeChange);
  }
}

export async function promptInstall(): Promise<void> {
  if (installBusy() || !deferredPrompt) return;
  const event = deferredPrompt;
  deferredPrompt = null;
  setCanInstall(false);
  setInstallBusy(true);
  try {
    await event.prompt();
  } finally {
    setInstallBusy(false);
  }
}

/** 测试夹具：直接写入信号，不经过浏览器事件。 */
export function installPwaSignals(next: {
  canInstall?: boolean;
  isStandalone?: boolean;
  isIosLike?: boolean;
  isLoopbackHost?: boolean;
  isSecureContext?: boolean;
  installBusy?: boolean;
}): void {
  if (next.canInstall !== undefined) setCanInstall(next.canInstall);
  if (next.isStandalone !== undefined) setIsStandalone(next.isStandalone);
  if (next.isIosLike !== undefined) setIsIosLike(next.isIosLike);
  if (next.isLoopbackHost !== undefined) setIsLoopbackHost(next.isLoopbackHost);
  if (next.isSecureContext !== undefined) setIsSecureContext(next.isSecureContext);
  if (next.installBusy !== undefined) setInstallBusy(next.installBusy);
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
  setIsLoopbackHost(false);
  setIsSecureContext(false);
  setInstallBusy(false);
}
