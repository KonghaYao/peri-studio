import { Match, Show, Switch } from 'solid-js';
import { Button } from '@peri/ui';

/** 文档用的规范 loopback 配方，不是「当前这次安装」的 origin。 */
const DEFAULT_LOOPBACK_RECIPE = 'http://127.0.0.1:8456';

type BrowserInstallKind = 'installed' | 'install' | 'a2hs' | 'cannot-install';

type BrowserPreviewProps = {
  label: string;
  origin: string;
  kind: BrowserInstallKind;
};

function AboutBrowserPreview(props: BrowserPreviewProps) {
  const hasInstallAction = () => props.kind === 'install' || props.kind === 'a2hs';
  return (
    <section class="rounded-12 border border-divider bg-surface px-16 py-14" aria-label={props.label}>
      <p class="m-0 text-10 font-medium tracking-caps uppercase text-content-faint">{props.label}</p>
      <h3 class="mt-8 mb-0 text-13 font-semibold text-text-primary">This browser</h3>
      <Show when={hasInstallAction()}>
        <p class="mt-6 mb-0 text-12 leading-155 text-text-secondary">
          Install adds a shortcut to {props.origin}. This is a local shortcut; the window is useless when this server stops.
        </p>
      </Show>
      <Switch>
        <Match when={props.kind === 'installed'}>
          <p class="mt-8 mb-0 text-12 text-text-primary" role="status">Installed</p>
        </Match>
        <Match when={props.kind === 'install'}>
          <Button variant="secondary" size="compact" class="mt-8">Install</Button>
        </Match>
        <Match when={props.kind === 'a2hs'}>
          <p class="mt-8 mb-0 text-12 text-text-primary">Open Share, then Add to Home Screen</p>
          <p class="mt-6 mb-0 text-12 leading-155 text-text-secondary">
            A Home Screen app uses its own storage and may ask you to sign in again.
          </p>
        </Match>
        <Match when={props.kind === 'cannot-install'}>
          <p class="mt-8 mb-0 text-12 text-text-secondary">Cannot install here</p>
        </Match>
      </Switch>
    </section>
  );
}

/** T4 · System About：mock 互斥安装态，供生产 ThisBrowserBlock 镜像。 */
export function SystemAboutLayout() {
  return (
    <div class="flex max-w-md flex-col gap-12">
      <AboutBrowserPreview
        label="Chrome / Edge can install"
        origin={DEFAULT_LOOPBACK_RECIPE}
        kind="install"
      />
      <AboutBrowserPreview
        label="Standalone window"
        origin={DEFAULT_LOOPBACK_RECIPE}
        kind="installed"
      />
      <AboutBrowserPreview
        label="Safari on loopback iOS"
        origin={DEFAULT_LOOPBACK_RECIPE}
        kind="a2hs"
      />
      <AboutBrowserPreview
        label="Cannot install here"
        origin={DEFAULT_LOOPBACK_RECIPE}
        kind="cannot-install"
      />
      <p class="m-0 text-11 leading-155 text-text-secondary">
        Default loopback recipe (not this page&apos;s origin): {DEFAULT_LOOPBACK_RECIPE}
      </p>
    </div>
  );
}
