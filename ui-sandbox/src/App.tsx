import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { parseSandboxHash, type SandboxRoute } from '@/catalog/page-sections';
import { HomePage } from './pages/HomePage';
import { TokensPage } from './pages/TokensPage';
import { ComponentsPage } from './pages/ComponentsPage';
import { ComponentsFormsPage } from './pages/ComponentsFormsPage';
import { ComponentsOverlaysPage } from './pages/ComponentsOverlaysPage';
import { ComponentsAiPage } from './pages/ComponentsAiPage';
import { ComponentsMarkdownPage } from './pages/ComponentsMarkdownPage';
import { ComponentsShellPage } from './pages/ComponentsShellPage';
import { ComponentsComposerPage } from './pages/ComponentsComposerPage';
import { ComponentsExplorerPage } from './pages/ComponentsExplorerPage';
import { ComponentsGitPage } from './pages/ComponentsGitPage';
import { SandboxShell } from './shell/SandboxShell';

export function App() {
  const [route, setRoute] = createSignal<SandboxRoute>(parseSandboxHash().route);

  onMount(() => {
    if (!window.location.hash) {
      history.replaceState(null, '', '#/home');
    }
    const onHashChange = () => setRoute(parseSandboxHash().route);
    window.addEventListener('hashchange', onHashChange);
    onCleanup(() => window.removeEventListener('hashchange', onHashChange));
  });

  return (
    <SandboxShell>
      <Show when={route() === 'home'}><HomePage /></Show>
      <Show when={route() === 'tokens'}><TokensPage /></Show>
      <Show when={route() === 'components'}><ComponentsPage /></Show>
      <Show when={route() === 'components-forms'}><ComponentsFormsPage /></Show>
      <Show when={route() === 'components-overlays'}><ComponentsOverlaysPage /></Show>
      <Show when={route() === 'components-ai'}><ComponentsAiPage /></Show>
      <Show when={route() === 'components-markdown'}><ComponentsMarkdownPage /></Show>
      <Show when={route() === 'components-shell'}><ComponentsShellPage /></Show>
      <Show when={route() === 'components-composer'}><ComponentsComposerPage /></Show>
      <Show when={route() === 'components-explorer'}><ComponentsExplorerPage /></Show>
      <Show when={route() === 'components-git'}><ComponentsGitPage /></Show>
    </SandboxShell>
  );
}
