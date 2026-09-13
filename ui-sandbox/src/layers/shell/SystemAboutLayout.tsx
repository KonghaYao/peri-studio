import { Show } from 'solid-js';
import { Button } from '@peri/ui';

type BrowserPreviewProps = {
  label: string;
  canInstall?: boolean;
  isStandalone?: boolean;
  isIosLike?: boolean;
};

function AboutBrowserPreview(props: BrowserPreviewProps) {
  return (
    <section class="rounded-12 border border-divider bg-surface px-16 py-14" aria-label={props.label}>
      <p class="m-0 text-10 font-medium tracking-caps uppercase text-content-faint">{props.label}</p>
      <h3 class="mt-8 mb-0 text-13 font-semibold text-text-primary">This browser</h3>
      <p class="mt-6 mb-0 text-12 leading-155 text-text-secondary">
        Install adds a shortcut to this machine&apos;s Peri Studio at http://127.0.0.1:8456/. The window still needs the local server. It does not work offline.
      </p>
      <Show when={props.isStandalone}>
        <p class="mt-8 mb-0 text-12 text-text-primary">Installed</p>
      </Show>
      <Show when={!props.isStandalone && props.canInstall}>
        <Button variant="secondary" size="compact" class="mt-8">Install</Button>
      </Show>
      <Show when={!props.isStandalone && props.isIosLike}>
        <p class="mt-8 mb-0 text-12 text-text-primary">Open Share, then Add to Home Screen</p>
        <p class="mt-6 mb-0 text-12 leading-155 text-text-secondary">
          A Home Screen app uses its own storage and may ask you to sign in again.
        </p>
      </Show>
    </section>
  );
}

/** T4 · System About：mock canInstall / standalone / iOS hint，供生产 SettingsDialog 镜像。 */
export function SystemAboutLayout() {
  return (
    <div class="flex max-w-md flex-col gap-12">
      <AboutBrowserPreview label="Chrome / Edge can install" canInstall />
      <AboutBrowserPreview label="Standalone window" isStandalone />
      <AboutBrowserPreview label="Safari on iOS" isIosLike />
    </div>
  );
}
