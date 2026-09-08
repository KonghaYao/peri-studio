import { afterEach, describe, expect, it, vi } from 'vitest';
import { authInvalidation, clearAuthInvalidation, installPrincipalRole, principalRole } from '@/features/auth/auth-state';
import { createAuthController, type AuthControllerDeps } from './auth-hook';

const transport = vi.hoisted(() => ({
  resetAuthenticatedSession: vi.fn(),
  connectWithCookie: vi.fn(),
}));

// createAuthController 的 store 依赖经注入传入（auth-hook 不反向依赖 store）。
function makeAuth(deps: Partial<AuthControllerDeps> = {}) {
  return createAuthController({ resetSession: transport.resetAuthenticatedSession, ...deps });
}

vi.mock('@/features/connection/connection', () => ({ connectWithCookie: transport.connectWithCookie }));

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  transport.resetAuthenticatedSession.mockReset();
  transport.connectWithCookie.mockReset();
  installPrincipalRole(null);
  clearAuthInvalidation();
});

function okFetch(payload: unknown = { role: 'full', principalId: 'principal-full-1' }, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ ok: status < 400, status, json: async () => payload }));
}

describe('createAuthController', () => {
  it('uses the one-time local bootstrap after an unauthenticated first status check', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/bootstrap')) {
        return { ok: true, status: 200, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) };
      }
      expect(init?.method).toBeUndefined();
      return { ok: false, status: 401, json: async () => ({ authenticated: false }) };
    });
    vi.stubGlobal('fetch', fetch);
    const auth = makeAuth();

    await auth.init();

    expect(auth.state()).toBe('signed-in');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/auth/session/bootstrap', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(localStorage.getItem('peri_studio_token')).toBeNull();
    expect(transport.connectWithCookie).toHaveBeenCalledOnce();
  });

  it('falls back to first-launch bootstrap after a stale remembered token is rejected', async () => {
    localStorage.setItem('peri_studio_token', 'stale-token');
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/bootstrap')) {
        return { ok: true, status: 200, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) };
      }
      return { ok: false, status: 401, json: async () => ({ authenticated: false }) };
    });
    vi.stubGlobal('fetch', fetch);
    const auth = makeAuth();

    await auth.init();

    expect(auth.state()).toBe('signed-in');
    expect(localStorage.getItem('peri_studio_token')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith('/api/auth/session/bootstrap', {
      method: 'POST',
      credentials: 'same-origin',
    });
  });

  it('treats an unavailable bootstrap as the normal explicit-login fallback', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/bootstrap')) {
        return { ok: false, status: 409, json: async () => ({ authenticated: false }) };
      }
      return { ok: false, status: 401, json: async () => ({ authenticated: false }) };
    });
    vi.stubGlobal('fetch', fetch);
    const auth = makeAuth();

    await auth.init();

    expect(auth.state()).toBe('signed-out');
    expect(auth.problem()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not attempt bootstrap when the status failure is retryable', async () => {
    const fetch = okFetch({ error: 'auth_busy' }, 503);
    vi.stubGlobal('fetch', fetch);
    const auth = makeAuth();

    await auth.init();

    expect(auth.state()).toBe('signed-out');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('fails closed when a successful response carries an unknown role', async () => {
    vi.stubGlobal('fetch', okFetch({ role: 'instance' }));
    const auth = makeAuth();

    await auth.status();

    expect(auth.state()).toBe('signed-out');
    expect(auth.problem()).toMatchObject({ kind: 'server' });
    expect(transport.connectWithCookie).not.toHaveBeenCalled();
    expect(transport.resetAuthenticatedSession).toHaveBeenCalledOnce();
  });

  it('signs in and installs the principal role after a successful status check', async () => {
    vi.stubGlobal('fetch', okFetch());
    const auth = makeAuth();

    await auth.status();

    expect(auth.state()).toBe('signed-in');
    expect(principalRole()).toBe('full');
    expect(transport.resetAuthenticatedSession).toHaveBeenCalledWith({ preserveLocalDrafts: true });
    expect(transport.connectWithCookie).toHaveBeenCalledOnce();
  });

  it('keeps the authoritative server token path when status is rejected with setup', async () => {
    const command = "PERI_STUDIO_CONFIG_DIR='/custom/peri studio' peri-studio token generate --name web --role full";
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        authenticated: false,
        setup: { tokenFile: '/custom/peri studio/tokens.toml', generateCommand: command },
      }),
    })));
    const auth = makeAuth();

    await auth.status();

    expect(auth.state()).toBe('signed-out');
    expect(auth.setup()).toEqual({ tokenFile: '/custom/peri studio/tokens.toml', generateCommand: command });
  });

  it('does not invent a default path when the setup payload is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'auth_busy', setup: { tokenFile: 42 } }),
    })));
    const auth = makeAuth();

    await auth.status();

    expect(auth.setup()).toBeNull();
    expect(auth.problem()).not.toBeNull();
  });

  it('clears a remembered token when a replayed login is rejected with 401', async () => {
    localStorage.setItem('peri_studio_token', 'revoked-token');
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: false, status: 401, json: async () => ({ authenticated: false }) };
      return { ok: false, status: 401 };
    }));
    const auth = makeAuth();

    await auth.submitToken('revoked-token');

    expect(auth.state()).toBe('signed-out');
    expect(localStorage.getItem('peri_studio_token')).toBeNull();
    expect(transport.connectWithCookie).not.toHaveBeenCalled();
  });

  it('remembers a full token and connects after a successful login', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) };
      return { ok: false, status: 401 };
    }));
    const auth = makeAuth();

    await auth.submitToken('saved-token');

    expect(auth.state()).toBe('signed-in');
    expect(auth.token()).toBe('');
    expect(localStorage.getItem('peri_studio_token')).toBe('saved-token');
    expect(transport.resetAuthenticatedSession).toHaveBeenCalledWith({ preserveLocalDrafts: true });
    expect(transport.connectWithCookie).toHaveBeenCalledOnce();
    expect(authInvalidation()).toBeNull();
  });

  it('rejects an unknown role on login without remembering anything', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ role: 'instance' }) })));
    const auth = makeAuth();

    await auth.submitToken('some-token');

    expect(auth.state()).toBe('signed-out');
    expect(localStorage.getItem('peri_studio_token')).toBeNull();
  });

  it('ignores a stale status success that resolves after invalidation', async () => {
    let resolveStatus!: (value: { ok: boolean; status: number; json: () => Promise<{ role: string }> }) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveStatus = resolve; })));
    const auth = makeAuth();

    const pending = auth.status();
    auth.handleInvalidation({ reason: 'cookie revoked while checking' });
    expect(auth.state()).toBe('signed-out');
    expect(auth.problem()).toMatchObject({ kind: 'credential' });

    resolveStatus({ ok: true, status: 200, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) });
    await pending;
    await Promise.resolve();

    expect(auth.state()).toBe('signed-out');
    expect(transport.connectWithCookie).not.toHaveBeenCalled();
    expect(transport.resetAuthenticatedSession).toHaveBeenCalledOnce();
  });

  it('replays a remembered token on init without asking for input', async () => {
    localStorage.setItem('peri_studio_token', 'saved-token');
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) };
      return { ok: false, status: 401 };
    });
    vi.stubGlobal('fetch', fetch);
    const auth = makeAuth();

    auth.init();
    await vi.waitFor(() => expect(auth.state()).toBe('signed-in'));

    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'saved-token' }) }),
    );
    expect(transport.connectWithCookie).toHaveBeenCalledOnce();
  });

  it('falls back to checking the cookie session when no token is remembered', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) }));
    vi.stubGlobal('fetch', fetch);
    const auth = makeAuth();

    auth.init();
    await vi.waitFor(() => expect(auth.state()).toBe('signed-in'));

    expect(fetch).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({ cache: 'no-store' }));
  });

  it('replays the remembered token after invalidation instead of clearing it', async () => {
    localStorage.setItem('peri_studio_token', 'saved-token');
    const post = vi.fn(async () => ({ ok: true, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) }));
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return post();
      return { ok: false, status: 401 };
    });
    vi.stubGlobal('fetch', fetch);
    const auth = makeAuth();

    await auth.submitToken('saved-token');
    expect(auth.state()).toBe('signed-in');

    // server 重启/会话 TTL 后 ws 4502 → invalidation：不得清除 token，
    // 而是自动重放一次并恢复已登录状态。
    auth.handleInvalidation({ reason: 'server restarted' });
    await vi.waitFor(() => expect(post.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(auth.state()).toBe('signed-in');
    expect(localStorage.getItem('peri_studio_token')).toBe('saved-token');
  });

  it('falls back to the login form when invalidation cannot be replayed', () => {
    vi.stubGlobal('fetch', vi.fn());
    const auth = makeAuth();

    auth.handleInvalidation({ reason: 'token revoked by administrator' });

    expect(auth.state()).toBe('signed-out');
    expect(auth.problem()).toMatchObject({ kind: 'credential', message: 'token revoked by administrator' });
  });

  it('keeps a manual re-login signed in when a stale invalidation-era response resolves', async () => {
    // invalidation 落回登录表单 → 手动重新登录成功 → 旧事件（invalidation
    // 前在途的 status 响应）晚到：requestEpoch 已推进，不得把用户再次登出。
    let resolveStatus!: (value: { ok: boolean; status: number; json: () => Promise<{ role: string }> }) => void;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve({ ok: true, status: 200, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) });
      return new Promise((resolve) => { resolveStatus = resolve; });
    }));
    const auth = makeAuth();

    const pending = auth.status();
    auth.handleInvalidation({ reason: 'session revoked while checking' });
    expect(auth.state()).toBe('signed-out');

    await auth.submitToken('fresh-token');
    expect(auth.state()).toBe('signed-in');

    resolveStatus({ ok: true, status: 200, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) });
    await pending;
    await Promise.resolve();

    expect(auth.state()).toBe('signed-in');
    // invalidation 1 次 + 登录成功 1 次；旧响应被 epoch 忽略，未被再次调用。
    expect(transport.resetAuthenticatedSession.mock.calls.length).toBe(2);
  });

  it('clears the remembered token and session on logout', async () => {
    localStorage.setItem('peri_studio_token', 'saved-token');
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { ok: true };
      return { ok: true, json: async () => ({ role: 'full', principalId: 'principal-full-1' }) };
    }));
    const auth = makeAuth();

    await auth.submitToken('saved-token');
    await auth.logout();

    expect(localStorage.getItem('peri_studio_token')).toBeNull();
    expect(auth.state()).toBe('signed-out');
    expect(principalRole()).toBeNull();
  });

  it('reports a network problem when logout cannot reach the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const auth = makeAuth();

    await auth.logout();

    expect(auth.state()).toBe('signed-out');
    expect(auth.problem()).toMatchObject({ kind: 'network', retryable: true });
  });
});
