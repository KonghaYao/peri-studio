import { describe, expect, it, vi } from 'vitest';
import { fetchMonitorCapability } from './capability';

describe('monitor capability', () => {
  it('reads the credential-free health flag', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ langfuse: true }),
    });
    await expect(fetchMonitorCapability(fetcher)).resolves.toEqual({ enabled: true });
    expect(fetcher).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }));
  });

  it('fails closed when health is unavailable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchMonitorCapability(fetcher)).resolves.toEqual({ enabled: false });
  });

  it('fails closed when langfuse is absent or false', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    await expect(fetchMonitorCapability(fetcher)).resolves.toEqual({ enabled: false });
  });
});
