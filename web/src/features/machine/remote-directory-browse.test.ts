import { describe, expect, it } from 'vitest';
import {
  INSTANCE_BROWSE_ROOT,
  joinRemotePath,
  RemoteDirectoryBrowser,
  supportsInstanceScopedBrowse,
} from './remote-directory-browse';

describe('remote-directory-browse', () => {
  it('reports that instance-scoped open-view is available', () => {
    expect(supportsInstanceScopedBrowse()).toBe(true);
  });

  it('joins absolute browse paths from instance root and relative segments', () => {
    expect(joinRemotePath(INSTANCE_BROWSE_ROOT, 'home/user/projects/demo')).toBe('/home/user/projects/demo');
    expect(joinRemotePath(INSTANCE_BROWSE_ROOT, '')).toBe('/');
  });

  it('opens browse with instanceId instead of a project anchor', () => {
    const sent: unknown[] = [];
    const browser = new RemoteDirectoryBrowser({
      ready: () => true,
      send: (frame) => { sent.push(frame); return true; },
      subscribe: () => undefined,
      unsubscribe: () => undefined,
    });
    browser.open('ssh_1', []);
    const frame = sent[0] as { instanceId?: string; projectId?: string; type?: string };
    expect(frame.type).toBe('resource/open-view');
    expect(frame.instanceId).toBe('ssh_1');
    expect(frame.projectId).toBeUndefined();
  });

  it('releases the ephemeral lease on close', () => {
    const sent: unknown[] = [];
    const browser = new RemoteDirectoryBrowser({
      ready: () => true,
      send: (frame) => { sent.push(frame); return true; },
      subscribe: () => undefined,
      unsubscribe: () => undefined,
    });
    browser.open('ssh_1', []);
    browser.handleResult({
      t: 'resource_result',
      requestId: (sent[0] as { requestId: string }).requestId,
      result: {
        kind: 'view',
        data: {
          viewId: 'view-1',
          docId: 'resource:view-1',
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    });
    browser.close();
    expect(sent.some((frame) => (frame as { type?: string }).type === 'resource/release-view')).toBe(true);
  });
});
