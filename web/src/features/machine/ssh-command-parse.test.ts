import { describe, expect, it } from 'vitest';
import { parseSshCommandInput, stripEmbeddedSshCredential } from './ssh-command-parse';

describe('stripEmbeddedSshCredential', () => {
  it('removes password or api key from user:secret@host', () => {
    expect(stripEmbeddedSshCredential('root:placeholder@104.21.1.1')).toEqual({
      destination: 'root@104.21.1.1',
      strippedCredential: true,
    });
  });

  it('leaves user@host unchanged', () => {
    expect(stripEmbeddedSshCredential('ubuntu@gpu.example')).toEqual({
      destination: 'ubuntu@gpu.example',
      strippedCredential: false,
    });
  });
});

describe('parseSshCommandInput', () => {
  it('accepts bare destination', () => {
    const result = parseSshCommandInput('user@host.example');
    expect(result).toEqual({
      ok: true,
      value: { destination: 'user@host.example', warnings: [], credentialStripped: false },
    });
  });

  it('parses ssh -p -i and destination', () => {
    const result = parseSshCommandInput('ssh -p 2222 -i /Users/me/.ssh/id_ed25519 user@host');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destination).toBe('user@host');
    expect(result.value.port).toBe(2222);
    expect(result.value.identityFile).toBe('/Users/me/.ssh/id_ed25519');
  });

  it('parses combined short flags', () => {
    const result = parseSshCommandInput('ssh -p2222 -i/Users/me/key ubuntu@1.2.3.4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(2222);
    expect(result.value.identityFile).toBe('/Users/me/key');
  });

  it('applies -l user when destination is host only', () => {
    const result = parseSshCommandInput('ssh -l ubuntu gpu-box');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destination).toBe('ubuntu@gpu-box');
  });

  it('strips embedded api key from pasted destination', () => {
    const result = parseSshCommandInput('ssh root:my-api-key@104.0.0.1 -p 443');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destination).toBe('root@104.0.0.1');
    expect(result.value.port).toBe(443);
    expect(result.value.warnings.some((w) => /api keys/i.test(w))).toBe(true);
  });

  it('warns when identity uses tilde', () => {
    const result = parseSshCommandInput('ssh -i ~/.ssh/id_ed25519 user@host');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.identityFile).toBe('~/.ssh/id_ed25519');
    expect(result.value.warnings.some((w) => /full path/i.test(w))).toBe(true);
  });

  it('rejects unsupported ProxyCommand', () => {
    const result = parseSshCommandInput('ssh -o ProxyCommand=evil user@host');
    expect(result).toEqual({ ok: false, error: 'SSH option "ProxyCommand" is not supported in Peri.' });
  });

  it('warns when remote command is present', () => {
    const result = parseSshCommandInput('ssh user@host uptime');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.some((w) => /ignored/i.test(w))).toBe(true);
  });
});
