export type PickDirectoryResult =
  | { kind: 'selected'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }
  | { kind: 'error' };

/** 通过 loopback server 唤起本机目录选择器。 */
export async function pickProjectDirectory(): Promise<PickDirectoryResult> {
  try {
    const response = await fetch('/api/local/pick-directory', {
      method: 'POST',
      credentials: 'include',
    });
    if (response.status === 401) return { kind: 'unauthorized' };
    if (response.status === 503) return { kind: 'unavailable' };
    if (!response.ok) return { kind: 'error' };
    const body = await response.json() as { cancelled?: boolean; path?: string };
    if (body.cancelled) return { kind: 'cancelled' };
    if (typeof body.path === 'string' && body.path.trim()) {
      return { kind: 'selected', path: body.path.trim() };
    }
    return { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}
