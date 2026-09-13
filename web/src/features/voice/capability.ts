// 只读 /api/health 的 realtimeVoice 位。不含 URL / key。

export type VoiceCapability = {
  enabled: boolean;
};

export async function fetchVoiceCapability(
  fetcher: typeof fetch = fetch,
): Promise<VoiceCapability> {
  try {
    const response = await fetcher('/api/health', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return { enabled: false };
    const body = (await response.json()) as { realtimeVoice?: unknown };
    return { enabled: body.realtimeVoice === true };
  } catch {
    return { enabled: false };
  }
}

export function voiceSocketUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/voice`;
}
