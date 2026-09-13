import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canInstall,
  installPwaSignals,
  isIosLike,
  isStandalone,
  promptInstall,
  resetPwaForTests,
  startPwa,
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

function stubMatchMedia(standalone: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('display-mode: standalone') ? standalone : false,
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
  it('detects standalone display mode and iOS-like clients', () => {
    stubMatchMedia(true);
    stubNavigator({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    startPwa();
    expect(isStandalone()).toBe(true);
    expect(isIosLike()).toBe(true);
    expect(canInstall()).toBe(false);
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
  });
});
