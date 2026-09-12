import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { parseSandboxHash, type SandboxRoute } from '@/catalog/page-sections';
import { TokensPage } from './pages/TokensPage';
import { ComponentsPage } from './pages/ComponentsPage';
import { ComponentsPage2 } from './pages/ComponentsPage2';
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
      <Show when={route() === 'components2'}><ComponentsPage2 /></Show>
      <Show when={route() === 'blocks'}><BlocksPage /></Show>
      <Show when={route() === 'layers'}><LayersPage /></Show>
    </SandboxShell>
  );
}
