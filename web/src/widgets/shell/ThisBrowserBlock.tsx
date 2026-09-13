// System About「This browser」：本机安装入口。文案英文；不注册 Service Worker。

import { Show } from 'solid-js';
import { Button } from '@peri/ui';
import { canInstall, isIosLike, isStandalone, promptInstall } from '@/features/pwa/pwa-state';

export function ThisBrowserBlock() {
  return (
    <section class="mt-14" data-testid="this-browser" aria-labelledby="this-browser-heading">
      <h2 id="this-browser-heading" class="m-0 text-13 font-semibold text-text-primary">This browser</h2>
      <p class="mt-6 mb-0 text-12 leading-155 text-text-secondary">
        Install adds a shortcut to this machine&apos;s Peri Studio at http://127.0.0.1:8456/. The window still needs the local server. It does not work offline.
      </p>
      <Show when={isStandalone()}>
        <p class="mt-8 mb-0 text-12 text-text-primary">Installed</p>
      </Show>
      <Show when={!isStandalone() && canInstall()}>
        <Button variant="secondary" size="compact" class="mt-8" onClick={() => { void promptInstall(); }}>
          Install
        </Button>
      </Show>
      <Show when={!isStandalone() && isIosLike()}>
        <p class="mt-8 mb-0 text-12 text-text-primary">Open Share, then Add to Home Screen</p>
        <p class="mt-6 mb-0 text-12 leading-155 text-text-secondary">
          A Home Screen app uses its own storage and may ask you to sign in again.
        </p>
      </Show>
    </section>
  );
}
