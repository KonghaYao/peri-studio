import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setChatCatalog, setGlobalStatus, setInstances, setMachines, setSchemaVersion } from '@/store';
import { setConnState } from '@/features/connection/connection';
import { installPwaSignals, resetPwaForTests, startPwa } from '@/features/pwa/pwa-state';
import { SettingsDialog } from './SettingsDialog';

function resetStore() {
  setInstances([]);
  setMachines([]);
  setChatCatalog([]);
  setGlobalStatus('healthy');
  setSchemaVersion(3);
  setConnState({ text: 'Connected', kind: 'ok' });
}

function openAbout() {
  render(() => <SettingsDialog open onClose={() => undefined} />);
  fireEvent.click(screen.getByRole('tab', { name: 'About' }));
}

function installPromptEvent(prompt: () => Promise<void>) {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = prompt;
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  return event;
}

afterEach(() => {
  resetStore();
  resetPwaForTests();
  vi.unstubAllGlobals();
});

describe('SettingsDialog', () => {
  it('opens on the machines tab by default and renders the machines list', () => {
    setMachines([{
      instanceId: 'local',
      kind: 'local',
      displayName: 'This computer',
      sshDestination: null,
      sshPort: null,
      phase: 'online',
      errorCode: null,
      hasIdentityFile: false,
      autoReconnect: true,
      hostKeySha256: null,
      updatedAt: null,
      archivedAt: null,
    }]);
    setInstances([{ id: 'local', hostname: 'macbook.local', status: 'online', tokenId: 'token-1', registeredAt: null, lastHeartbeat: null, chatCount: 0 }]);
    render(() => <SettingsDialog open onClose={() => undefined} />);

    expect(screen.getByRole('dialog', { name: 'System' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'System sections' })).toBeInTheDocument();
    const machinesTab = screen.getByRole('tab', { name: 'Machines' });
    expect(machinesTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('list', { name: 'Computer list' })).toBeInTheDocument();
    expect(screen.getByText('This computer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add computer' })).toBeInTheDocument();
  });

  it('switches to the about tab and shows server facts', () => {
    render(() => <SettingsDialog open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(screen.getByRole('tab', { name: 'About' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText(/schema 3/)).toBeInTheDocument();
  });

  it('shows this-browser cannot-install as the default exclusive branch', () => {
    openAbout();

    const block = document.querySelector('#this-browser');
    expect(block).toBeInTheDocument();
    expect(screen.getByTestId('this-browser')).toBe(block);
    expect(screen.getByText('Cannot install here')).toBeInTheDocument();
    expect(screen.queryByText(/local shortcut/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.queryByText('Installed')).not.toBeInTheDocument();
    expect(screen.queryByText('Open Share, then Add to Home Screen')).not.toBeInTheDocument();
    expect(screen.queryByText(/127\.0\.0\.1:8456/)).not.toBeInTheDocument();
  });

  it('shows Install on the About this-browser block when the prompt is available', () => {
    installPwaSignals({ canInstall: true, isStandalone: false, isIosLike: false });
    openAbout();

    expect(screen.getByTestId('this-browser')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(location.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.getByText(/local shortcut/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    expect(screen.queryByText('Installed')).not.toBeInTheDocument();
    expect(screen.queryByText('Open Share, then Add to Home Screen')).not.toBeInTheDocument();
    expect(screen.queryByText('Cannot install here')).not.toBeInTheDocument();
    expect(screen.queryByText(/127\.0\.0\.1:8456/)).not.toBeInTheDocument();
  });

  it('shows Installed when the window is already standalone', () => {
    installPwaSignals({ canInstall: false, isStandalone: true, isIosLike: false });
    openAbout();

    expect(screen.getByRole('status')).toHaveTextContent('Installed');
    expect(screen.queryByText(/local shortcut/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.queryByText('Open Share, then Add to Home Screen')).not.toBeInTheDocument();
    expect(screen.queryByText('Cannot install here')).not.toBeInTheDocument();
  });

  it('shows Safari home-screen steps only on secure loopback iOS', () => {
    installPwaSignals({
      canInstall: false,
      isStandalone: false,
      isIosLike: true,
      isSecureContext: true,
      isLoopbackHost: true,
    });
    openAbout();

    expect(screen.getByText('Open Share, then Add to Home Screen')).toBeInTheDocument();
    expect(screen.getByText(/own storage and may ask you to sign in again/)).toBeInTheDocument();
    expect(screen.getByText(/local shortcut/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.queryByText('Installed')).not.toBeInTheDocument();
    expect(screen.queryByText('Cannot install here')).not.toBeInTheDocument();
  });

  it('does not offer A2HS on iOS-like LAN HTTP', () => {
    installPwaSignals({
      canInstall: false,
      isStandalone: false,
      isIosLike: true,
      isSecureContext: false,
      isLoopbackHost: false,
    });
    openAbout();

    expect(screen.getByText('Cannot install here')).toBeInTheDocument();
    expect(screen.queryByText('Open Share, then Add to Home Screen')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('lets startPwa capture beforeinstallprompt and the Install click call prompt', async () => {
    const prompt = vi.fn(async () => undefined);
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    startPwa();
    window.dispatchEvent(installPromptEvent(prompt));
    openAbout();

    const install = screen.getByRole('button', { name: 'Install' });
    fireEvent.click(install);
    expect(prompt).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
      expect(screen.getByText('Cannot install here')).toBeInTheDocument();
    });
  });

  it('disables Install while a prompt is in flight', () => {
    installPwaSignals({ canInstall: true, installBusy: true });
    openAbout();

    expect(screen.getByRole('button', { name: /Install/ })).toBeDisabled();
    expect(screen.queryByText('Cannot install here')).not.toBeInTheDocument();
    expect(screen.queryByText('Open Share, then Add to Home Screen')).not.toBeInTheDocument();
  });

  it('invokes onClose via Escape', () => {
    const onClose = vi.fn();
    render(() => <SettingsDialog open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
