// 只读 /api/health 的 langfuse 位。不含 host / key / project id。

export type MonitorCapability = {
  enabled: boolean;
};

export async function fetchMonitorCapability(
  fetcher: typeof fetch = fetch,
): Promise<MonitorCapability> {
  try {
    const response = await fetcher('/api/health', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return { enabled: false };
    const body = (await response.json()) as { langfuse?: unknown };
    return { enabled: body.langfuse === true };
  } catch {
    return { enabled: false };
  }
}
