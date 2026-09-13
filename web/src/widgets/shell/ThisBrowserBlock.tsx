// System About「This browser」：本浏览器安装入口（浏览器 chrome，不是用户偏好）。
// 文案英文；origin 由调用方注入，不硬编码 loopback；不注册 Service Worker。

import { Match, Show, Switch } from 'solid-js';
import { Button } from '@peri/ui';
import { browserInstallKind, installBusy, promptInstall } from '@/features/pwa/pwa-state';

export function ThisBrowserBlock(props: { origin: string }) {
  const kind = () => browserInstallKind();
  const hasInstallAction = () => kind() === 'install' || kind() === 'a2hs';

  return (
    <section id="this-browser" class="mt-14" data-testid="this-browser" aria-labelledby="this-browser-heading">
      <h2 id="this-browser-heading" class="m-0 text-13 font-semibold text-text-primary">This browser</h2>
      <Show when={hasInstallAction()}>
        <p class="mt-6 mb-0 text-12 leading-155 text-text-secondary">
          Install adds a shortcut to {props.origin}. This is a local shortcut; the window is useless when this server stops.
        </p>
      </Show>
      <Switch>
        <Match when={kind() === 'installed'}>
          <p class="mt-8 mb-0 text-12 text-text-primary" role="status">Installed</p>
        </Match>
        <Match when={kind() === 'install'}>
          <Button
            variant="secondary"
            size="compact"
            class="mt-8"
            busy={installBusy()}
            disabled={installBusy()}
            onClick={() => { void promptInstall(); }}
          >
            Install
          </Button>
        </Match>
        <Match when={kind() === 'a2hs'}>
          <p class="mt-8 mb-0 text-12 text-text-primary">Open Share, then Add to Home Screen</p>
          <p class="mt-6 mb-0 text-12 leading-155 text-text-secondary">
            A Home Screen app uses its own storage and may ask you to sign in again.
          </p>
        </Match>
        <Match when={kind() === 'cannot-install'}>
          <p class="mt-8 mb-0 text-12 text-text-secondary">Cannot install here</p>
        </Match>
      </Switch>
    </section>
  );
}
