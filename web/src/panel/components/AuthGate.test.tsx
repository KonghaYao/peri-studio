// 渲染与接线层测试：登录表单、setup 提示、context 提供。
// 状态机行为（网络 fetch / localStorage / requestEpoch / invalidation
// 恢复）已随 P4 拆分迁移到 lib/auth-hook.test.ts，此处只验证 AuthGate
// 正确消费 useAuth 并把 UI 渲染出来。

import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAuthInvalidation, installPrincipalRole, publishAuthInvalidation } from '../lib/auth-state';

const transport = vi.hoisted(() => ({
  resetAuthenticatedSession: vi.fn(),
  connectWithCookie: vi.fn(),
}));

vi.mock('../store', () => ({ resetAuthenticatedSession: transport.resetAuthenticatedSession }));
vi.mock('../lib/connection', () => ({ connectWithCookie: transport.connectWithCookie }));

import { AuthGate } from './AuthGate';
import { useAuthActions } from '../lib/auth-hook';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  transport.resetAuthenticatedSession.mockReset();
  transport.connectWithCookie.mockReset();
  installPrincipalRole(null);
  clearAuthInvalidation();
});

describe('AuthGate rendering', () => {
  it('keeps sign-in checks in one labeled shared live region', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(() => <AuthGate><div>authenticated workspace</div></AuthGate>);

    const status = screen.getByRole('status', { name: 'Checking sign-in state' });
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Checking sign-in state');
    expect(status.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('shows the authoritative server token path and generation command', async () => {
    const command = "PERI_STUDIO_CONFIG_DIR='/custom/peri studio' peri-studio-server token generate --name web --role full";
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        authenticated: false,
        setup: { tokenFile: '/custom/peri studio/tokens.toml', generateCommand: command },
      }),
    })));

    render(() => <AuthGate><div>authenticated workspace</div></AuthGate>);
    await screen.findByLabelText('Access token');
    fireEvent.click(screen.getByText('Where is my token?'));

    expect(screen.getByText('/custom/peri studio/tokens.toml')).toBeInTheDocument();
    expect(screen.getByText(command)).toBeInTheDocument();
    expect(screen.queryByText('~/.config/peri-studio/tokens.toml')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy generate command' })).toBeInTheDocument();
  });

  it('does not invent a default path when the setup payload is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'auth_busy', setup: { tokenFile: 42 } }),
    })));

    render(() => <AuthGate><div>authenticated workspace</div></AuthGate>);

    expect(await screen.findByRole('alert')).toHaveTextContent('this does not mean the token is invalid');
    fireEvent.click(screen.getByText('Where is my token?'));
    expect(screen.getByText(/The server did not provide a config path/)).toBeInTheDocument();
    expect(screen.getByText('peri-studio-server token generate --name web --role full')).toBeInTheDocument();
  });

  it('replays a remembered token on mount without asking for input', async () => {
    localStorage.setItem('peri_studio_token', 'saved-token');
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ role: 'full' }) };
      return { ok: false, status: 401 };
    });
    vi.stubGlobal('fetch', fetch);

    render(() => <AuthGate><div>authenticated workspace</div></AuthGate>);

    expect(await screen.findByText('authenticated workspace')).toBeInTheDocument();
    expect(screen.queryByLabelText('Access token')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'saved-token' }) }),
    );
    expect(transport.connectWithCookie).toHaveBeenCalledOnce();
  });

  it('falls back to the login form when a remembered token is rejected', async () => {
    localStorage.setItem('peri_studio_token', 'revoked-token');
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: false, status: 401, json: async () => ({ authenticated: false }) };
      return { ok: false, status: 401 };
    }));

    render(() => <AuthGate><div>authenticated workspace</div></AuthGate>);

    expect(await screen.findByLabelText('Access token')).toBeInTheDocument();
    expect(screen.queryByText('authenticated workspace')).not.toBeInTheDocument();
    expect(transport.connectWithCookie).not.toHaveBeenCalled();
    // 401 = 令牌确实无效，记住的 token 一并清除。
    expect(localStorage.getItem('peri_studio_token')).toBeNull();
  });

  it('replays the remembered token after websocket invalidation instead of clearing it', async () => {
    localStorage.setItem('peri_studio_token', 'saved-token');
    const post = vi.fn(async () => ({ ok: true, json: async () => ({ role: 'full' }) }));
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return post();
      return { ok: false, status: 401 };
    });
    vi.stubGlobal('fetch', fetch);

    render(() => <AuthGate><div>authenticated workspace</div></AuthGate>);
    expect(await screen.findByText('authenticated workspace')).toBeInTheDocument();
    expect(localStorage.getItem('peri_studio_token')).toBe('saved-token');

    // server 重启/会话 TTL 后 ws 4502 → invalidation：不得清除 token，
    // 而是自动重放一次并恢复已登录状态。
    publishAuthInvalidation('server restarted');
    await waitFor(() => expect(post.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText('authenticated workspace')).toBeInTheDocument();
    expect(localStorage.getItem('peri_studio_token')).toBe('saved-token');
    expect(screen.queryByLabelText('Access token')).not.toBeInTheDocument();
  });

  it('clears the remembered token on logout through the actions context', async () => {
    localStorage.setItem('peri_studio_token', 'saved-token');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { ok: true };
      if (init?.method === 'POST') return { ok: true, json: async () => ({ role: 'full' }) };
      return { ok: false, status: 401 };
    }));

    function LogoutProbe() {
      const { logout } = useAuthActions()!;
      return <div>authenticated workspace<button type="button" onClick={() => logout()}>Sign out</button></div>;
    }

    render(() => <AuthGate><LogoutProbe /></AuthGate>);
    expect(await screen.findByText('authenticated workspace')).toBeInTheDocument();
    expect(localStorage.getItem('peri_studio_token')).toBe('saved-token');

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(localStorage.getItem('peri_studio_token')).toBeNull());
    expect(await screen.findByLabelText('Access token')).toBeInTheDocument();
  });
});
