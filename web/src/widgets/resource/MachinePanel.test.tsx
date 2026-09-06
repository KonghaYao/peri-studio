import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { installPrincipalRole } from '../../panel/lib/auth-state';
import { setGlobalStatus, setInstances, setMachines, setSchemaVersion } from '../../panel/store';
import { MachinePanel } from './MachinePanel';

afterEach(() => {
  cleanup();
  installPrincipalRole(null);
  setMachines([]);
  setInstances([]);
  setGlobalStatus('healthy');
  setSchemaVersion(3);
});

describe('MachinePanel', () => {
  it('renders ssh rows with primary actions and overflow menu', () => {
    installPrincipalRole('full');
    setMachines([
      {
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
      },
      {
        instanceId: 'ssh_demo',
        kind: 'ssh',
        displayName: 'GPU box',
        sshDestination: 'user@gpu.example',
        sshPort: 22,
        phase: 'offline',
        errorCode: null,
        hasIdentityFile: false,
        autoReconnect: true,
        hostKeySha256: null,
        updatedAt: null,
        archivedAt: null,
      },
    ]);
    setInstances([
      { id: 'local', hostname: 'dev', status: 'online', tokenId: 't1', registeredAt: null, lastHeartbeat: null, chatCount: 0 },
    ]);
    render(() => <MachinePanel />);

    expect(screen.getByText('GPU box')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'GPU box actions' })).toBeInTheDocument();
  });

  it('auto-opens trust dialog for awaiting_host_key when writable', () => {
    installPrincipalRole('full');
    setMachines([
      {
        instanceId: 'ssh_trust',
        kind: 'ssh',
        displayName: 'New host',
        sshDestination: 'user@new.example',
        sshPort: null,
        phase: 'awaiting_host_key',
        errorCode: null,
        hasIdentityFile: false,
        autoReconnect: true,
        hostKeySha256: 'SHA256:abc123',
        updatedAt: null,
        archivedAt: null,
      },
    ]);
    render(() => <MachinePanel />);

    expect(screen.getByRole('dialog', { name: 'Trust host' })).toBeInTheDocument();
    expect(screen.getByText('SHA256:abc123')).toBeInTheDocument();
  });

  it('does not auto-open trust dialog in read-only mode', () => {
    installPrincipalRole('read-only');
    setMachines([
      {
        instanceId: 'ssh_trust',
        kind: 'ssh',
        displayName: 'New host',
        sshDestination: 'user@new.example',
        sshPort: null,
        phase: 'awaiting_host_key',
        errorCode: null,
        hasIdentityFile: false,
        autoReconnect: true,
        hostKeySha256: 'SHA256:abc123',
        updatedAt: null,
        archivedAt: null,
      },
    ]);
    render(() => <MachinePanel />);

    expect(screen.queryByRole('dialog', { name: 'Trust host' })).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for the owner to trust this host.')).toBeInTheDocument();
  });
});
