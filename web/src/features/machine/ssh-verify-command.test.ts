import { describe, expect, it } from 'vitest';
import { buildSshAddKeyCommand, buildSshVerifyShellCommand, shouldOfferSshVerifyCommand } from './ssh-verify-command';

describe('buildSshVerifyShellCommand', () => {
  it('builds port and destination', () => {
    expect(buildSshVerifyShellCommand({ destination: 'user@host', port: 443 })).toBe(
      'ssh -p 443 user@host',
    );
  });

  it('includes identity file', () => {
    expect(buildSshVerifyShellCommand({
      destination: 'user@host',
      identityFile: '/Users/me/.ssh/id_ed25519',
    })).toBe('ssh -i /Users/me/.ssh/id_ed25519 user@host');
  });

  it('adds auth options when password or api key was stripped', () => {
    expect(buildSshVerifyShellCommand({
      destination: 'root@104.0.0.1',
      port: 22,
      interactivePassword: true,
    })).toBe(
      'ssh -p 22 -o PreferredAuthentications=publickey,password,keyboard-interactive root@104.0.0.1',
    );
  });
});

describe('buildSshAddKeyCommand', () => {
  it('uses apple keychain hint on macOS-oriented copy', () => {
    expect(buildSshAddKeyCommand('/Users/me/key')).toBe('ssh-add --apple-use-keychain /Users/me/key');
  });
});

describe('shouldOfferSshVerifyCommand', () => {
  it('shows when credential was stripped from paste', () => {
    expect(shouldOfferSshVerifyCommand({
      destination: 'user@host',
      credentialStripped: true,
    })).toBe(true);
  });

  it('shows when identity still uses tilde', () => {
    expect(shouldOfferSshVerifyCommand({
      destination: 'user@host',
      credentialStripped: false,
      identityFile: '~/.ssh/id_ed25519',
    })).toBe(true);
  });
});
