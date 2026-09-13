import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setChatCatalog, setGlobalStatus, setInstances, setMachines, setSchemaVersion } from '@/store';
import { setConnState } from '@/features/connection/connection';
import { installPwaSignals, resetPwaForTests } from '@/features/pwa/pwa-state';
import { SettingsDialog } from './SettingsDialog';

function resetStore() {
  setInstances([]);
  setMachines([]);
  setChatCatalog([]);
  setGlobalStatus('healthy');
  setSchemaVersion(3);
  setConnState({ text: 'Connected', kind: 'ok' });
}

afterEach(() => {
  resetStore();
  resetPwaForTests();
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

  it('shows Install on the About this-browser block when the prompt is available', () => {
    installPwaSignals({ canInstall: true, isStandalone: false, isIosLike: false });
    render(() => <SettingsDialog open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(screen.getByTestId('this-browser')).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/127\.0\.0\.1:8456\//)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    expect(screen.queryByText('Installed')).not.toBeInTheDocument();
    expect(screen.queryByText('Open Share, then Add to Home Screen')).not.toBeInTheDocument();
  });

  it('shows Installed when the window is already standalone', () => {
    installPwaSignals({ canInstall: false, isStandalone: true, isIosLike: false });
    render(() => <SettingsDialog open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.queryByText('Open Share, then Add to Home Screen')).not.toBeInTheDocument();
  });

  it('shows Safari home-screen steps on iOS-like browsers', () => {
    installPwaSignals({ canInstall: false, isStandalone: false, isIosLike: true });
    render(() => <SettingsDialog open onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('tab', { name: 'About' }));

    expect(screen.getByText('Open Share, then Add to Home Screen')).toBeInTheDocument();
    expect(screen.getByText(/own storage and may ask you to sign in again/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.queryByText('Installed')).not.toBeInTheDocument();
  });

  it('invokes onClose via Escape', () => {
    const onClose = vi.fn();
    render(() => <SettingsDialog open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
