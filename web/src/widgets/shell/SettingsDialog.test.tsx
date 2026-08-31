import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setChatCatalog, setGlobalStatus, setInstances, setMachines, setSchemaVersion } from '../../panel/store';
import { setConnState } from '../../panel/lib/connection';
import { SettingsDialog } from './SettingsDialog';

function resetStore() {
  setInstances([]);
  setMachines([]);
  setChatCatalog([]);
  setGlobalStatus('healthy');
  setSchemaVersion(3);
  setConnState({ text: 'Connected', kind: 'ok' });
}

afterEach(resetStore);

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
    expect(screen.getByText('Server health')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Registry schema version')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('invokes onClose via Escape', () => {
    const onClose = vi.fn();
    render(() => <SettingsDialog open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
