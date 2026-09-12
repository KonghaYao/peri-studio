import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { parseSandboxHash, type SandboxRoute } from '@/catalog/page-sections';
import { TokensPage } from './pages/TokensPage';
import { ComponentsPage } from './pages/ComponentsPage';
import { ComponentsFormsPage } from './pages/ComponentsFormsPage';
import { ComponentsOverlaysPage } from './pages/ComponentsOverlaysPage';
import { ComponentsChatPage } from './pages/ComponentsChatPage';
import { ComponentsAiPage } from './pages/ComponentsAiPage';
import { ComponentsCodePage } from './pages/ComponentsCodePage';
import { BlocksPage } from './pages/BlocksPage';
import { LayersPage } from './pages/LayersPage';
import { SandboxShell } from './shell/SandboxShell';

export function App() {
  const [route, setRoute] = createSignal<SandboxRoute>(parseSandboxHash().route);

  onMount(() => {
    const onHashChange = () => setRoute(parseSandboxHash().route);
    window.addEventListener('hashchange', onHashChange);
    onCleanup(() => window.removeEventListener('hashchange', onHashChange));
  });

  return (
    <SandboxShell>
      <Show when={route() === 'tokens'}><TokensPage /></Show>
      <Show when={route() === 'components'}><ComponentsPage /></Show>
      <Show when={route() === 'components-forms'}><ComponentsFormsPage /></Show>
      <Show when={route() === 'components-overlays'}><ComponentsOverlaysPage /></Show>
      <Show when={route() === 'components-chat'}><ComponentsChatPage /></Show>
      <Show when={route() === 'components-ai'}><ComponentsAiPage /></Show>
      <Show when={route() === 'components-code'}><ComponentsCodePage /></Show>
      <Show when={route() === 'blocks'}><BlocksPage /></Show>
      <Show when={route() === 'layers'}><LayersPage /></Show>
    </SandboxShell>
  );
}
