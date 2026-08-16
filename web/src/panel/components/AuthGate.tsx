// 鉴权门：signed-in 时渲染应用（并提供登出 context），否则渲染登录页。
//
// 网络 fetch、localStorage 持久化、状态机与 requestEpoch 竞态都在
// `lib/auth-hook`（createAuthController / useAuth）；本组件只保留渲染与
// context 提供（P4）。

import { Show, type JSX } from 'solid-js';
import { AuthActionsContext, useAuth } from '../lib/auth-hook';
import { resetAuthenticatedSession } from '../store';
import { Button, CopyButton, TextField } from '../../ui';

export function AuthGate(props: { children: JSX.Element }) {
  const auth = useAuth({ resetSession: resetAuthenticatedSession });

  function signIn(e: SubmitEvent) {
    e.preventDefault();
    void auth.submitToken(auth.token().trim());
  }

  return (
    <Show when={auth.state() === 'signed-in'} fallback={
      <main class="auth-page grid min-h-dvh place-items-center bg-sidebar-bg p-24">
        <section class="auth-card w-(--container-auth-card) border border-border-subtle rounded-20 bg-surface p-34 shadow-auth" aria-labelledby="auth-title">
          <div class="auth-brand mb-42 text-14 font-650">Peri Studio</div>
          <h1 id="auth-title" class="text-28 -tracking-35">Continue your work</h1>
          <p class="mt-10 mb-26 text-14 leading-16 text-text-secondary">Sign in with a full token issued by the server to open a secure browser session. The token is stored in this browser and used to sign in automatically next time; to clear it, sign out from the top-right corner.</p>
          <Show when={auth.state() === 'checking'} fallback={
            <form onSubmit={signIn} class="auth-form">
              <TextField label="Access token" type="password" value={auth.token()} onInput={(e) => auth.setToken(e.currentTarget.value)} autocomplete="off" autofocus />
              <Show when={auth.problem()}>{(item) => <div class="auth-problem my-10 border border-danger-border rounded-10 bg-danger-soft px-12 py-11 text-13 leading-145 text-danger" role="alert"><p class="m-0">{item().message}</p><Show when={item().retryable}><Button type="button" variant="ghost" size="compact" class="mt-7" onClick={() => void auth.status()}>Re-check connection</Button></Show></div>}</Show>
              <Button variant="primary" type="submit" class="mt-8 w-full" busy={auth.submitting()} disabled={!auth.token().trim()}>Sign in</Button>
              <details class="auth-help mt-18 border-t border-divider pt-14 text-12 leading-155 text-text-secondary">
                <summary class="cursor-pointer font-semibold text-text-primary">Where is my token?</summary>
                <div class="pt-8">
                  <Show when={auth.setup()} fallback={<p class="my-7">The server did not provide a config path. If you already have a token, copy the token value from the same entry as <code class="text-11">role = "full"</code> in the <code class="text-11">tokens.toml</code> used to start the server.</p>}>
                    {(hint) => <><p class="my-7">This server reads tokens from:</p><code class="auth-command block overflow-auto whitespace-nowrap rounded-8 border border-divider bg-surface-muted px-10 py-9 text-11 text-text-primary">{hint().tokenFile}</code></>}
                  </Show>
                  <p class="my-7">If you have no full token, run this on the machine running the server:</p>
                  <code class="auth-command block overflow-auto whitespace-nowrap rounded-8 border border-divider bg-surface-muted px-10 py-9 text-11 text-text-primary">{auth.setup()?.generateCommand ?? 'peri-studio-server token generate --name web --role full'}</code>
                  <CopyButton class="mt-7" label="Copy generate command" copiedLabel="Generate command copied" text={auth.setup()?.generateCommand ?? 'peri-studio-server token generate --name web --role full'} size="compact" />
                  <p class="my-7">The command prints the full token only once. Do not commit it to code, logs or chat history.</p>
                </div>
              </details>
            </form>
          }>
            <span class="ui-spinner" aria-label="Checking sign-in state" />
          </Show>
        </section>
      </main>
    }><AuthActionsContext.Provider value={{ logout: () => { void auth.logout(); } }}><div class="authenticated-app">{props.children}</div></AuthActionsContext.Provider></Show>
  );
}
