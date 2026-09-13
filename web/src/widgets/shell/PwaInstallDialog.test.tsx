import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPrincipalRole, setPrincipalRole } from '@/features/auth/auth-state';
import {
  FIRST_LOGIN_INSTALL_WAIT_MS,
  hasAskedInstallPrompt,
  openInstallOfferDialog,
  PWA_INSTALL_PROMPT_STORAGE_KEY,
  resetPwaInstallPromptForTests,
} from '@/features/pwa/pwa-install-prompt';
import { installPwaSignals, resetPwaForTests } from '@/features/pwa/pwa-state';
import { PwaInstallDialog } from './PwaInstallDialog';
import { PwaInstallPrompt } from './PwaInstallPrompt';

afterEach(() => {
  cleanup();
  resetPwaInstallPromptForTests();
  resetPwaForTests();
  setPrincipalRole(null);
  vi.useRealTimers();
});

beforeEach(() => {
  resetPwaInstallPromptForTests();
  resetPwaForTests();
  setPrincipalRole(null);
});

describe('PwaInstallDialog', () => {
  it('runs Install and Not now for the Chrome offer', () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();
    render(() => (
      <PwaInstallDialog
        open
        kind="chrome"
        origin="http://127.0.0.1:8456"
        onInstall={onInstall}
        onDismiss={onDismiss}
      />
    ));

    expect(screen.getByRole('dialog', { name: 'Install Peri Studio?' })).toBeInTheDocument();
    expect(screen.getByText(/shortcut on this computer/)).toBeInTheDocument();
    expect(screen.getByText(/needs this local server/)).toBeInTheDocument();
    expect(screen.getByText(/useless if the server is stopped/)).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:8456/)).toBeInTheDocument();
    expect(screen.queryByText(/Open Share/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('explains A2HS and omits a fake Install button', () => {
    const onInstall = vi.fn();
    render(() => (
      <PwaInstallDialog
        open
        kind="a2hs"
        origin="http://localhost:8456"
        onInstall={onInstall}
        onDismiss={() => undefined}
      />
    ));

    expect(screen.getByText(/Open Share, then Add to Home Screen/)).toBeInTheDocument();
    expect(screen.getByText(/own storage and may ask you to sign in again/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('disables Install while the native prompt is busy', () => {
    render(() => (
      <PwaInstallDialog
        open
        kind="chrome"
        origin="http://127.0.0.1:8456"
        busy
        onInstall={() => undefined}
        onDismiss={() => undefined}
      />
    ));
    expect(screen.getByRole('button', { name: /Install/ })).toBeDisabled();
  });
});

describe('PwaInstallPrompt host', () => {
  it('shows once after signed-in when canInstall is already true', () => {
    installPwaSignals({ canInstall: true, isStandalone: false });
    installPrincipalRole('full');
    render(() => <PwaInstallPrompt />);

    expect(screen.getByRole('dialog', { name: 'Install Peri Studio?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(hasAskedInstallPrompt()).toBe(true);
    expect(localStorage.getItem(PWA_INSTALL_PROMPT_STORAGE_KEY)).toBe('asked');
    expect(screen.queryByRole('dialog', { name: 'Install Peri Studio?' })).not.toBeInTheDocument();
  });

  it('does not show when standalone or already asked', () => {
    installPwaSignals({ canInstall: true, isStandalone: true });
    installPrincipalRole('full');
    render(() => <PwaInstallPrompt />);
    expect(screen.queryByRole('dialog', { name: 'Install Peri Studio?' })).not.toBeInTheDocument();

    cleanup();
    resetPwaForTests();
    installPwaSignals({ canInstall: true, isStandalone: false });
    localStorage.setItem(PWA_INSTALL_PROMPT_STORAGE_KEY, 'asked');
    render(() => <PwaInstallPrompt />);
    expect(screen.queryByRole('dialog', { name: 'Install Peri Studio?' })).not.toBeInTheDocument();
  });

  it('skips when BIP never arrives within the short bound', () => {
    vi.useFakeTimers();
    installPwaSignals({ canInstall: false, isStandalone: false });
    installPrincipalRole('full');
    render(() => <PwaInstallPrompt />);
    expect(screen.queryByRole('dialog', { name: 'Install Peri Studio?' })).not.toBeInTheDocument();
    vi.advanceTimersByTime(FIRST_LOGIN_INSTALL_WAIT_MS);
    expect(screen.queryByRole('dialog', { name: 'Install Peri Studio?' })).not.toBeInTheDocument();
    installPwaSignals({ canInstall: true });
    expect(screen.queryByRole('dialog', { name: 'Install Peri Studio?' })).not.toBeInTheDocument();
  });

  it('does not show on the login page before principal is installed', () => {
    installPwaSignals({ canInstall: true, isStandalone: false });
    render(() => <PwaInstallPrompt />);
    expect(screen.queryByRole('dialog', { name: 'Install Peri Studio?' })).not.toBeInTheDocument();
  });

  it('can open A2HS help from a later menu request', () => {
    installPrincipalRole('full');
    render(() => <PwaInstallPrompt />);
    openInstallOfferDialog('a2hs');
    expect(screen.getByText(/Open Share, then Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });
});
