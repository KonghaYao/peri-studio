import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canOfferInstall,
  createFirstLoginInstallWatch,
  decideFirstLoginInstallPrompt,
  dismissInstallOfferDialog,
  FIRST_LOGIN_INSTALL_WAIT_MS,
  handleInstallMenuAction,
  hasAskedInstallPrompt,
  installDialogKind,
  installDialogOpen,
  openInstallOfferDialog,
  PWA_INSTALL_PROMPT_ASKED_VALUE,
  PWA_INSTALL_PROMPT_STORAGE_KEY,
  recordInstallPromptAsked,
  resetPwaInstallPromptForTests,
  resolveInstallOfferKind,
} from './pwa-install-prompt';
import { installPwaSignals, resetPwaForTests, startPwa } from './pwa-state';

afterEach(() => {
  resetPwaInstallPromptForTests();
  resetPwaForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  resetPwaInstallPromptForTests();
  resetPwaForTests();
});

describe('pwa install prompt persistence', () => {
  it('treats a missing key as not asked', () => {
    expect(hasAskedInstallPrompt()).toBe(false);
    expect(localStorage.getItem(PWA_INSTALL_PROMPT_STORAGE_KEY)).toBeNull();
  });

  it('records an origin-level asked flag without storing a token', () => {
    recordInstallPromptAsked();
    expect(hasAskedInstallPrompt()).toBe(true);
    expect(localStorage.getItem(PWA_INSTALL_PROMPT_STORAGE_KEY)).toBe(PWA_INSTALL_PROMPT_ASKED_VALUE);
    expect(localStorage.getItem('peri_studio_token')).toBeNull();
  });

  it('accepts an injected storage target', () => {
    const store = new Map<string, string>();
    const source = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    };
    expect(hasAskedInstallPrompt(source)).toBe(false);
    recordInstallPromptAsked(source);
    expect(hasAskedInstallPrompt(source)).toBe(true);
    expect(store.get(PWA_INSTALL_PROMPT_STORAGE_KEY)).toBe(PWA_INSTALL_PROMPT_ASKED_VALUE);
  });
});

describe('decideFirstLoginInstallPrompt', () => {
  const base = {
    signedIn: true,
    canInstall: false,
    canAddToHomeScreen: false,
    isStandalone: false,
    dismissed: false,
    waitElapsedMs: 0,
  };

  it('does not show when signed out, standalone, dismissed, or cannot install', () => {
    expect(decideFirstLoginInstallPrompt({ ...base, signedIn: false })).toEqual({
      show: false,
      reason: 'not-signed-in',
    });
    expect(decideFirstLoginInstallPrompt({ ...base, isStandalone: true, canInstall: true })).toEqual({
      show: false,
      reason: 'standalone',
    });
    expect(decideFirstLoginInstallPrompt({ ...base, dismissed: true, canInstall: true })).toEqual({
      show: false,
      reason: 'dismissed',
    });
    expect(decideFirstLoginInstallPrompt({
      ...base,
      waitElapsedMs: FIRST_LOGIN_INSTALL_WAIT_MS,
    })).toEqual({ show: false, reason: 'unavailable' });
  });

  it('shows Chrome when canInstall and A2HS when only the loopback gate is true', () => {
    expect(decideFirstLoginInstallPrompt({ ...base, canInstall: true })).toEqual({
      show: true,
      kind: 'chrome',
    });
    expect(decideFirstLoginInstallPrompt({ ...base, canAddToHomeScreen: true })).toEqual({
      show: true,
      kind: 'a2hs',
    });
    expect(decideFirstLoginInstallPrompt({
      ...base,
      canInstall: true,
      canAddToHomeScreen: true,
    })).toEqual({ show: true, kind: 'chrome' });
  });

  it('waits only until the short bound when BIP has not arrived', () => {
    expect(decideFirstLoginInstallPrompt(base)).toEqual({ show: false, reason: 'waiting' });
    expect(decideFirstLoginInstallPrompt({
      ...base,
      waitElapsedMs: FIRST_LOGIN_INSTALL_WAIT_MS - 1,
    })).toEqual({ show: false, reason: 'waiting' });
  });
});

describe('install offer visibility', () => {
  it('hides Install when window-controls-overlay counts as installed', () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query.includes('display-mode: window-controls-overlay'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    startPwa();
    expect(canOfferInstall()).toBe(false);
    expect(resolveInstallOfferKind()).toBeNull();

    const onOffer = vi.fn();
    const watch = createFirstLoginInstallWatch({ signedIn: () => true, onOffer });
    watch.evaluate();
    expect(onOffer).not.toHaveBeenCalled();
    watch.dispose();
    vi.unstubAllGlobals();
  });

  it('hides Install when standalone even if a prompt is still cached', () => {
    installPwaSignals({
      canInstall: true,
      isStandalone: true,
      isIosLike: true,
      isSecureContext: true,
      isLoopbackHost: true,
    });
    expect(canOfferInstall()).toBe(false);
    expect(resolveInstallOfferKind()).toBeNull();
  });

  it('offers Chrome or loopback A2HS when not standalone', () => {
    installPwaSignals({ canInstall: true, isStandalone: false });
    expect(canOfferInstall()).toBe(true);
    expect(resolveInstallOfferKind()).toBe('chrome');

    installPwaSignals({
      canInstall: false,
      isStandalone: false,
      isIosLike: true,
      isSecureContext: true,
      isLoopbackHost: true,
    });
    expect(canOfferInstall()).toBe(true);
    expect(resolveInstallOfferKind()).toBe('a2hs');
  });

  it('does not offer A2HS on iOS-like LAN HTTP', () => {
    installPwaSignals({
      canInstall: false,
      isStandalone: false,
      isIosLike: true,
      isSecureContext: false,
      isLoopbackHost: false,
    });
    expect(canOfferInstall()).toBe(false);
    expect(resolveInstallOfferKind()).toBeNull();
  });
});

describe('createFirstLoginInstallWatch', () => {
  it('offers immediately when canInstall is already true', () => {
    const onOffer = vi.fn();
    installPwaSignals({ canInstall: true, isStandalone: false });
    const watch = createFirstLoginInstallWatch({ signedIn: () => true, onOffer });
    watch.evaluate();
    expect(onOffer).toHaveBeenCalledOnce();
    expect(onOffer).toHaveBeenCalledWith('chrome');
    watch.evaluate();
    expect(onOffer).toHaveBeenCalledOnce();
    watch.dispose();
  });

  it('does not show when standalone or already asked', () => {
    const onOffer = vi.fn();
    installPwaSignals({ canInstall: true, isStandalone: true });
    const watch = createFirstLoginInstallWatch({ signedIn: () => true, onOffer });
    watch.evaluate();
    expect(onOffer).not.toHaveBeenCalled();
    watch.dispose();

    resetPwaForTests();
    installPwaSignals({ canInstall: true, isStandalone: false });
    recordInstallPromptAsked();
    const asked = createFirstLoginInstallWatch({ signedIn: () => true, onOffer });
    asked.evaluate();
    expect(onOffer).not.toHaveBeenCalled();
    asked.dispose();
  });

  it('offers Chrome when BIP arrives during the short wait', () => {
    const onOffer = vi.fn();
    const schedule = vi.fn((callback: () => void) => {
      void callback;
      return 1;
    });
    const cancel = vi.fn();
    installPwaSignals({ canInstall: false, isStandalone: false });
    const watch = createFirstLoginInstallWatch({
      signedIn: () => true,
      onOffer,
      schedule,
      cancel,
    });
    watch.evaluate();
    watch.evaluate();
    expect(schedule).toHaveBeenCalledOnce();
    expect(onOffer).not.toHaveBeenCalled();

    installPwaSignals({ canInstall: true });
    watch.evaluate();
    expect(onOffer).toHaveBeenCalledWith('chrome');
    expect(cancel).toHaveBeenCalledOnce();
    watch.dispose();
  });

  it('skips when the wait bound expires before BIP', () => {
    const onOffer = vi.fn();
    let timeout: (() => void) | undefined;
    const schedule = vi.fn((callback: () => void) => {
      timeout = callback;
      return 1;
    });
    installPwaSignals({ canInstall: false, isStandalone: false });
    const watch = createFirstLoginInstallWatch({
      signedIn: () => true,
      onOffer,
      schedule,
    });
    watch.evaluate();
    expect(onOffer).not.toHaveBeenCalled();
    if (!timeout) throw new Error('expected first-login wait timer');
    timeout();
    expect(onOffer).not.toHaveBeenCalled();
    watch.evaluate();
    installPwaSignals({ canInstall: true });
    watch.evaluate();
    expect(onOffer).not.toHaveBeenCalled();
    watch.dispose();
  });

  it('does not start waiting until signed in', () => {
    const onOffer = vi.fn();
    const schedule = vi.fn(() => 1);
    installPwaSignals({ canInstall: true, isStandalone: false });
    let signedIn = false;
    const watch = createFirstLoginInstallWatch({
      signedIn: () => signedIn,
      onOffer,
      schedule,
    });
    watch.evaluate();
    expect(onOffer).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    signedIn = true;
    watch.evaluate();
    expect(onOffer).toHaveBeenCalledWith('chrome');
    watch.dispose();
  });
});

describe('install dialog and menu actions', () => {
  it('dismissing records asked and closes the dialog', () => {
    openInstallOfferDialog('chrome');
    expect(installDialogOpen()).toBe(true);
    dismissInstallOfferDialog();
    expect(installDialogOpen()).toBe(false);
    expect(hasAskedInstallPrompt()).toBe(true);
    expect(installDialogKind()).toBe('chrome');
  });

  it('opens A2HS help from the menu when Chrome cannot prompt', () => {
    installPwaSignals({
      canInstall: false,
      isStandalone: false,
      isIosLike: true,
      isSecureContext: true,
      isLoopbackHost: true,
    });
    handleInstallMenuAction();
    expect(hasAskedInstallPrompt()).toBe(true);
    expect(installDialogOpen()).toBe(true);
    expect(installDialogKind()).toBe('a2hs');
  });
});
