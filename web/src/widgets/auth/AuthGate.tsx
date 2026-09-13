// 鉴权门：signed-in 时渲染应用（并提供登出 context），否则渲染登录页。
//
// 网络 fetch、localStorage 持久化、状态机与 requestEpoch 竞态都在
// `lib/auth-hook`（createAuthController / useAuth）；本组件只保留渲染与
// context 提供（P4）。

import { Show, type JSX } from 'solid-js';
import { AuthActionsContext, useAuth } from '@/features/auth/auth-hook';
import { resetAuthenticatedSession } from '@/store';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CopyButton,
  Field,
  FieldGroup,
  FieldLabel,
  InlineNotice,
  LoadingState,
  TextField,
} from '@peri/ui';

export function AuthGate(props: { children: JSX.Element }) {
  const auth = useAuth({
    resetSession: resetAuthenticatedSession,
  });

  function signIn(e: SubmitEvent) {
    e.preventDefault();
    void auth.submitToken(auth.token().trim());
  }

  return (
    <Show when={auth.state() === 'signed-in'} fallback={
      <main class="grid min-h-dvh place-items-center bg-sidebar-bg p-safe-min-24">
        <Card class="w-(--container-auth-card) rounded-16 border-border-subtle p-34 shadow-auth" aria-labelledby="auth-title">
          <CardHeader class="gap-0 p-0">
            <div class="mb-42 text-14 font-650">Peri Studio</div>
            <h1 id="auth-title" class="text-28 -tracking-35">Continue your work</h1>
            <p class="mt-10 mb-26 text-14 leading-16 text-text-secondary">Peri Studio signs in this browser automatically on first local launch. If you signed out or use a separately managed server, enter a full token issued by that server.</p>
          </CardHeader>
          <CardContent class="gap-0 p-0">
            {/* checking 不得挡住表单：status/bootstrap fetch 挂起时用户仍须能贴 token 进入。 */}
            <Show when={auth.state() === 'checking'}>
              <LoadingState label="Checking sign-in state" class="mb-18 justify-center" />
            </Show>
            <form onSubmit={signIn}>
              <FieldGroup>
                <Field>
                  <FieldLabel for="auth-access-token">Access token</FieldLabel>
                  <TextField id="auth-access-token" type="password" value={auth.token()} onInput={(e) => auth.setToken(e.currentTarget.value)} autocomplete="off" autofocus />
                </Field>
              </FieldGroup>
              <Show when={auth.problem()}>{(item) => <InlineNotice tone="danger" class="my-10" role="alert"><p>{item().message}</p><Show when={item().retryable}><Button type="button" variant="ghost" size="compact" class="mt-7" onClick={() => void auth.status()}>Re-check connection</Button></Show></InlineNotice>}</Show>
              <Button variant="primary" type="submit" class="mt-8 w-full" busy={auth.submitting()} disabled={!auth.token().trim()}>Sign in</Button>
              <details class="mt-18 border-t border-divider pt-14 text-12 leading-155 text-text-secondary">
                <summary class="cursor-pointer font-semibold text-text-primary">Where is my token?</summary>
                <div class="pt-8">
                  <Show when={auth.setup()} fallback={<p class="my-7">The server did not provide a config path. If you already have a token, copy the token value from the same entry as <code class="text-11">role = "full"</code> in the <code class="text-11">tokens.toml</code> used to start the server.</p>}>
                    {(hint) => <><p class="my-7">This server reads tokens from:</p><code class="block overflow-auto whitespace-nowrap rounded-8 border border-divider bg-surface-muted px-10 py-9 text-11 text-text-primary">{hint().tokenFile}</code></>}
                  </Show>
                  <p class="my-7">If you have no full token, run this on the server host:</p>
                  <code class="block overflow-auto whitespace-nowrap rounded-8 border border-divider bg-surface-muted px-10 py-9 text-11 text-text-primary">{auth.setup()?.generateCommand ?? 'peri-studio token generate --name web --role full'}</code>
                  <CopyButton class="mt-7" label="Copy generate command" copiedLabel="Generate command copied" text={auth.setup()?.generateCommand ?? 'peri-studio token generate --name web --role full'} size="compact" />
                  <p class="my-7">The command prints the full token only once. Do not commit it to code, logs or chat history.</p>
                </div>
              </details>
            </form>
          </CardContent>
        </Card>
      </main>
    }><AuthActionsContext.Provider value={{ logout: () => { void auth.logout(); } }}>{props.children}</AuthActionsContext.Provider></Show>
  );
}
