// 鉴权会话控制器（auth-hook）：网络 fetch + localStorage 持久化 + 状态机 +
// requestEpoch 竞态令牌。
//
// 从 AuthGate 拆出（P4）：AuthGate 只保留渲染与 context 提供，全部行为
// （status 检查 / token 提交 / 登出 / invalidation 恢复 / 记住的 token
// 重放）收敛到这里。`useAuthActions` 作为公共契约也在此导出，消费方
// （ProjectSidebar 等）不再直连 feature 组件 AuthGate。
//
// 设计：`createAuthController` 不依赖组件生命周期（可直接在测试中
// 实例化）；`useAuth` 是组件适配层，负责挂载时 init 与 authInvalidation
// 订阅。requestEpoch 保证并发请求中只有最后一次响应生效。store 的
// resetAuthenticatedSession 经依赖注入传入（本 lib 不反向依赖 store）。

import { createContext, createEffect, createSignal, onMount, useContext } from 'solid-js';
import { connectWithCookie } from '@/features/connection/connection';
import { parsePrincipal } from './auth-role';
import { authFeedback } from './auth-feedback.ts';
import { authInvalidation, clearAuthInvalidation, installPrincipalRole } from '@/features/auth/auth-state';
import { parseAuthSetup, type AuthSetup } from './auth-setup';

export type AuthState = 'checking' | 'signed-out' | 'signed-in';
export type AuthProblem = ReturnType<typeof authFeedback>;
export interface AuthActions {
  logout: () => void;
}

export interface AuthControllerDeps {
  /** 清空旧运行时；同一 principal 的成功重连可保留按身份隔离的持久草稿。 */
  resetSession: (options?: { preserveLocalDrafts?: boolean }) => void;
  onPrincipalInstalled?: (principalId: string) => void;
}

export const AuthActionsContext = createContext<AuthActions>();
export const useAuthActions = (): AuthActions | undefined => useContext(AuthActionsContext);

/**
 * 已记住的 full token（localStorage）。仅用于下次打开时自动重放
 * `POST /api/auth/session`，server 会话本身仍是 HttpOnly cookie。
 * 登出或 server 判定 token 失效时立即清除。
 *
 * 已知风险（记录于此处，见 docs/architecture.md 浏览器认证契约与 loopback
 * 封闭协议章节）：full token 落 localStorage 扩大了 XSS 窃取面——任何能注入
 * 脚本的漏洞都能直接读到该凭据并离线重放，而 HttpOnly cookie 无此暴露。
 * 当前缓解：Web 面板无 HTML 注入面（框架默认转义）、下行 markdown 走白名单
 * 渲染、认证 HTTP 面仅限同源 loopback。移除条件：server 端引入短期 session
 * token 重放（如一次性/短 TTL 交换）或 remember-me cookie 方案后，此存储
 * 应整体下线并迁移旧值。
 */
const TOKEN_KEY = 'peri_studio_token';
/** 与 server HTTP 读超时对齐并留余量；超时后必须离开 checking，否则登录表单被挡住。 */
const AUTH_FETCH_TIMEOUT_MS = 8_000;

function rememberToken(value: string) {
  try {
    localStorage.setItem(TOKEN_KEY, value);
  } catch {
    // 存储不可用（隐私模式/禁用）时静默降级为每次手动输入。
  }
}

function rememberedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function forgetToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 同上，忽略。
  }
}

async function fetchAuth(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createAuthController(deps: AuthControllerDeps) {
  const [state, setState] = createSignal<AuthState>('checking');
  const [token, setToken] = createSignal('');
  const [problem, setProblem] = createSignal<AuthProblem>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [setup, setSetup] = createSignal<AuthSetup | null>(null);
  let requestEpoch = 0;

  function resetRuntime(options?: { preserveLocalDrafts?: boolean }): void {
    try {
      deps.resetSession(options);
    } catch {
      // 身份复位失败不得把 UI 钉死在 checking。
    }
  }

  function connectTransport(): void {
    try {
      connectWithCookie();
    } catch {
      // Cookie 会话已成立；传输错误交给连接态 UI，不能把已登录回滚成检查中。
    }
  }

  async function authPayload(res: Response): Promise<{ payload: unknown; setup: AuthSetup | null }> {
    try {
      const payload: unknown = await res.json();
      return { payload, setup: parseAuthSetup(payload) };
    } catch {
      return { payload: null, setup: null };
    }
  }

  async function status() {
    const epoch = ++requestEpoch;
    setProblem(null);
    try {
      const res = await fetchAuth('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (epoch !== requestEpoch) return;
      const parsed = await authPayload(res);
      if (epoch !== requestEpoch) return;
      if (parsed.setup) setSetup(parsed.setup);
      if (!res.ok) {
        resetRuntime();
        setProblem(authFeedback(res.status, 'status'));
        return setState('signed-out');
      }
      const principal = parsePrincipal(parsed.payload);
      if (!principal) {
        resetRuntime();
        setProblem({ kind: 'server', message: 'The server returned an unrecognized access role; access to the app is blocked.', retryable: true });
        return setState('signed-out');
      }
      resetRuntime({ preserveLocalDrafts: true });
      installPrincipalRole(principal.role, principal.principalId);
      deps.onPrincipalInstalled?.(principal.principalId);
      clearAuthInvalidation();
      setState('signed-in');
      connectTransport();
    } catch {
      if (epoch === requestEpoch) {
        resetRuntime();
        setProblem(authFeedback(0, 'status'));
        setState('signed-out');
      }
    }
  }

  async function submitToken(raw: string) {
    const epoch = ++requestEpoch;
    setSubmitting(true);
    setProblem(null);
    try {
      const res = await fetchAuth('/api/auth/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: raw }),
      });
      if (epoch !== requestEpoch) return;
      const parsed = await authPayload(res);
      if (epoch !== requestEpoch) return;
      if (parsed.setup) setSetup(parsed.setup);
      if (!res.ok) {
        resetRuntime();
        // 401 = 令牌被撤销/无效，记住的 token 不值得保留；其他错误码
        // （网络/5xx）不清除，下次打开仍可重放。
        if (res.status === 401) forgetToken();
        setProblem(authFeedback(res.status, 'login'));
        return setState('signed-out');
      }
      const principal = parsePrincipal(parsed.payload);
      if (!principal) {
        resetRuntime();
        setProblem({ kind: 'server', message: 'The server returned an unrecognized access role; sign-in is blocked.', retryable: true });
        setState('signed-out');
        return;
      }
      rememberToken(raw);
      resetRuntime({ preserveLocalDrafts: true });
      installPrincipalRole(principal.role, principal.principalId);
      deps.onPrincipalInstalled?.(principal.principalId);
      clearAuthInvalidation();
      setToken('');
      setState('signed-in');
      connectTransport();
    } catch {
      if (epoch === requestEpoch) {
        resetRuntime();
        setProblem(authFeedback(0, 'login'));
        setState('signed-out');
      }
    } finally {
      if (epoch === requestEpoch) setSubmitting(false);
    }
  }

  async function bootstrap() {
    const epoch = ++requestEpoch;
    setProblem(null);
    try {
      const res = await fetchAuth('/api/auth/session/bootstrap', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (epoch !== requestEpoch) return;
      const parsed = await authPayload(res);
      if (epoch !== requestEpoch) return;
      if (parsed.setup) setSetup(parsed.setup);
      if (!res.ok) {
        resetRuntime();
        // 409 表示该一次性窗口不存在或已被消费，是已初始化实例的正常状态；
        // 静默退回显式登录，避免把正常 fallback 呈现为错误。
        setProblem(res.status === 409 ? null : authFeedback(res.status, 'login'));
        return setState('signed-out');
      }
      const principal = parsePrincipal(parsed.payload);
      if (!principal) {
        resetRuntime();
        setProblem({ kind: 'server', message: 'The server returned an unrecognized access role; sign-in is blocked.', retryable: true });
        return setState('signed-out');
      }
      resetRuntime({ preserveLocalDrafts: true });
      installPrincipalRole(principal.role, principal.principalId);
      deps.onPrincipalInstalled?.(principal.principalId);
      clearAuthInvalidation();
      setState('signed-in');
      connectTransport();
    } catch {
      if (epoch === requestEpoch) {
        resetRuntime();
        setProblem(authFeedback(0, 'login'));
        setState('signed-out');
      }
    }
  }

  /** 挂载时优先恢复既有凭据；首次本地启动尝试一次性 bootstrap。 */
  async function init() {
    const saved = rememberedToken();
    if (saved && saved.trim()) {
      await submitToken(saved.trim());
      if (state() === 'signed-out' && problem()?.kind === 'credential') {
        await bootstrap();
      }
      return;
    }
    await status();
    if (state() === 'signed-out' && !problem()) {
      await bootstrap();
    }
  }

  /** ws 4502 / 管理员撤销等 invalidation 事件的恢复逻辑。 */
  function handleInvalidation(event: { reason: string }) {
    requestEpoch += 1;
    resetRuntime();
    setSubmitting(false);
    // 不盲目清除记住的 token：4502 只是当前 cookie 失效（server 重启、
    // 会话 TTL），localStorage 里的 full token 通常仍然有效。先自动重放；
    // 重放被拒（401）时才由 submitToken 清除并退回手动输入。
    const saved = rememberedToken();
    if (saved && saved.trim()) {
      setProblem(null);
      void submitToken(saved.trim());
    } else {
      setProblem({ kind: 'credential', message: event.reason, retryable: false });
      setState('signed-out');
    }
  }

  async function logout() {
    requestEpoch += 1;
    forgetToken();
    resetRuntime();
    clearAuthInvalidation();
    installPrincipalRole(null);
    setState('signed-out');
    try {
      await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
    } catch {
      setProblem({ kind: 'network', message: 'Signed out locally, but the server did not confirm the logout. Re-check your sign-in state after the connection recovers.', retryable: true });
    }
  }

  return { state, token, setToken, problem, submitting, setup, status, submitToken, logout, init, handleInvalidation };
}

export type AuthController = ReturnType<typeof createAuthController>;

/** 组件适配层：挂载时自动检查/重放，并订阅 authInvalidation 事件。 */
export function useAuth(deps: AuthControllerDeps): AuthController {
  const controller = createAuthController(deps);
  onMount(controller.init);
  createEffect(() => {
    const event = authInvalidation();
    if (!event) return;
    controller.handleInvalidation(event);
  });
  return controller;
}
