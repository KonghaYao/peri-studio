import { describe, expect, it, vi } from 'vitest';
import { fetchVoiceCapability, voiceSocketUrl } from './capability';

describe('voice capability', () => {
  it('reads the credential-free health flag', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ realtimeVoice: true }),
    });
    await expect(fetchVoiceCapability(fetcher)).resolves.toEqual({ enabled: true });
    expect(fetcher).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }));
  });

  it('fails closed when health is unavailable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchVoiceCapability(fetcher)).resolves.toEqual({ enabled: false });
  });

  it('builds a same-origin voice socket url', () => {
    expect(voiceSocketUrl({ protocol: 'https:', host: '127.0.0.1:8456' })).toBe(
      'wss://127.0.0.1:8456/voice',
    );
  });
});
