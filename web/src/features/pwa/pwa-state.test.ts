import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserInstallKind,
  canAddToHomeScreen,
  canInstall,
  installBusy,
  installPwaSignals,
  isIosLike,
  isLoopbackHostname,
  isStandalone,
  needsTitlebarReinstall,
  promptInstall,
  resetPwaForTests,
  startPwa,
  WCO_VISIBLE_CLASS,
} from './pwa-state';

type PromptEventInit = {
  prompt?: () => Promise<void>;
};

function installPromptEvent(init: PromptEventInit = {}) {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = init.prompt ?? vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  return event;
}

function stubMatchMedia(standalone: boolean, overlay = false) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('display-mode: window-controls-overlay')
      ? overlay
      : query.includes('display-mode: standalone') ? standalone : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

function stubNavigator(next: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}) {
  const current = window.navigator;
  vi.stubGlobal('navigator', {
    ...current,
    userAgent: next.userAgent ?? current.userAgent,
    platform: next.platform ?? current.platform,
    maxTouchPoints: next.maxTouchPoints ?? current.maxTouchPoints,
    standalone: next.standalone,
  });
}

afterEach(() => {
  resetPwaForTests();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetPwaForTests();
  stubMatchMedia(false);
  stubNavigator({ userAgent: 'Mozilla/5.0', platform: 'MacIntel', maxTouchPoints: 0 });
});

describe('pwa state', () => {
  it('classifies loopback hostnames only', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('192.168.1.10')).toBe(false);
    expect(isLoopbackHostname('peri.local')).toBe(false);
  });

  it('detects standalone display mode and iOS-like clients', () => {
    stubMatchMedia(true);
    stubNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    startPwa();
    expect(isStandalone()).toBe(true);
    expect(isIosLike()).toBe(true);
    expect(canInstall()).toBe(false);
    expect(browserInstallKind()).toBe('installed');
  });

  it('treats window-controls-overlay display mode as installed', () => {
    stubMatchMedia(false, true);
    startPwa();
    expect(isStandalone()).toBe(true);
    expect(canInstall()).toBe(false);
    expect(browserInstallKind()).toBe('installed');
    expect(needsTitlebarReinstall()).toBe(false);
  });

  it('asks for reinstall only in an installed window when overlay exists but is not visible', () => {
    stubMatchMedia(true);
    const overlay = {
      visible: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('navigator', {
      ...window.navigator,
      userAgent: 'Mozilla/5.0',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      windowControlsOverlay: overlay,
    });
    startPwa();
    expect(isStandalone()).toBe(true);
    expect(needsTitlebarReinstall()).toBe(true);
    expect(document.documentElement.classList.contains(WCO_VISIBLE_CLASS)).toBe(false);
  });

  it('does not nag a browser tab even when windowControlsOverlay exists', () => {
    stubMatchMedia(false);
    vi.stubGlobal('navigator', {
      ...window.navigator,
      userAgent: 'Mozilla/5.0',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      windowControlsOverlay: {
        visible: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    startPwa();
    expect(isStandalone()).toBe(false);
    expect(needsTitlebarReinstall()).toBe(false);
    expect(browserInstallKind()).not.toBe('installed');
  });

  it('toggles html.ui-wco-visible from windowControlsOverlay geometrychange', () => {
    stubMatchMedia(true);
    const listeners: Array<() => void> = [];
    const overlay = {
      visible: false,
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        listeners.push(listener);
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('navigator', {
      ...window.navigator,
      userAgent: 'Mozilla/5.0',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      windowControlsOverlay: overlay,
    });
    startPwa();
    expect(overlay.addEventListener).toHaveBeenCalledWith('geometrychange', expect.any(Function));
    expect(document.documentElement.classList.contains(WCO_VISIBLE_CLASS)).toBe(false);

    overlay.visible = true;
    for (const listener of listeners) listener();
    expect(document.documentElement.classList.contains(WCO_VISIBLE_CLASS)).toBe(true);
    expect(needsTitlebarReinstall()).toBe(false);

    overlay.visible = false;
    for (const listener of listeners) listener();
    expect(document.documentElement.classList.contains(WCO_VISIBLE_CLASS)).toBe(false);
    expect(needsTitlebarReinstall()).toBe(true);
  });

  it('treats iOS navigator.standalone as installed', () => {
    stubMatchMedia(false);
    stubNavigator({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      standalone: true,
    });
    startPwa();
    expect(isStandalone()).toBe(true);
    expect(canInstall()).toBe(false);
  });

  it('treats iPadOS desktop UA with touch as iOS-like', () => {
    stubNavigator({ userAgent: 'Mozilla/5.0', platform: 'MacIntel', maxTouchPoints: 5 });
    startPwa();
    expect(isIosLike()).toBe(true);
    expect(isStandalone()).toBe(false);
  });

  it('gates A2HS to iOS-like secure loopback only', () => {
    installPwaSignals({ isIosLike: true, isSecureContext: true, isLoopbackHost: true });
    expect(canAddToHomeScreen()).toBe(true);
    expect(browserInstallKind()).toBe('a2hs');

    installPwaSignals({ isLoopbackHost: false });
    expect(canAddToHomeScreen()).toBe(false);
    expect(browserInstallKind()).toBe('cannot-install');

    installPwaSignals({ isLoopbackHost: true, isSecureContext: false });
    expect(canAddToHomeScreen()).toBe(false);

    installPwaSignals({ isIosLike: false, isSecureContext: true, isLoopbackHost: true });
    expect(canAddToHomeScreen()).toBe(false);
  });

  it('keeps Install and A2HS exclusive when a prompt is available', () => {
    installPwaSignals({
      canInstall: true,
      isStandalone: false,
      isIosLike: true,
      isSecureContext: true,
      isLoopbackHost: true,
    });
    expect(browserInstallKind()).toBe('install');
  });

  it('defers a one-shot beforeinstallprompt until promptInstall', async () => {
    const prompt = vi.fn(async () => undefined);
    startPwa();
    const event = installPromptEvent({ prompt });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(canInstall()).toBe(true);

    await promptInstall();
    expect(prompt).toHaveBeenCalledOnce();
    expect(canInstall()).toBe(false);

    await promptInstall();
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('nulls the deferred prompt before awaiting overlapping promptInstall calls', async () => {
    let releasePrompt: (() => void) | undefined;
    const prompt = vi.fn(() => new Promise<void>((resolve) => {
      releasePrompt = resolve;
    }));
    startPwa();
    window.dispatchEvent(installPromptEvent({ prompt }));
    expect(canInstall()).toBe(true);

    const first = promptInstall();
    const second = promptInstall();
    expect(canInstall()).toBe(false);
    expect(installBusy()).toBe(true);
    expect(browserInstallKind()).toBe('install');
    expect(prompt).toHaveBeenCalledOnce();

    releasePrompt?.();
    await Promise.all([first, second]);
    expect(prompt).toHaveBeenCalledOnce();
    expect(installBusy()).toBe(false);
    expect(canInstall()).toBe(false);
  });

  it('ignores beforeinstallprompt when already standalone', () => {
    stubMatchMedia(true);
    startPwa();
    window.dispatchEvent(installPromptEvent());
    expect(canInstall()).toBe(false);
  });

  it('marks standalone after appinstalled', () => {
    startPwa();
    window.dispatchEvent(installPromptEvent());
    expect(canInstall()).toBe(true);
    window.dispatchEvent(new Event('appinstalled'));
    expect(canInstall()).toBe(false);
    expect(isStandalone()).toBe(true);
  });

  it('does not register a service worker', () => {
    const register = vi.fn();
    vi.stubGlobal('navigator', {
      ...window.navigator,
      userAgent: 'Mozilla/5.0',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      serviceWorker: { register },
    });
    startPwa();
    expect(register).not.toHaveBeenCalled();
    expect(canInstall()).toBe(false);
  });

  it('is idempotent across startPwa calls', () => {
    startPwa();
    startPwa();
    window.dispatchEvent(installPromptEvent());
    expect(canInstall()).toBe(true);
  });

  it('lets tests install signals without browser events', () => {
    installPwaSignals({ canInstall: true, isStandalone: false, isIosLike: true });
    expect(canInstall()).toBe(true);
    expect(isIosLike()).toBe(true);
    expect(isStandalone()).toBe(false);
    expect(browserInstallKind()).toBe('install');
  });
});
