import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  clusterForRoute,
  defaultRouteForCluster,
  NAV_CLUSTERS,
  PAGE_CATALOG,
  parseSandboxHash,
  ROUTE_META,
  sandboxHref,
  scrollToSection,
  type NavClusterId,
  type SandboxRoute,
} from '@/catalog/page-sections';
import { cn, IconButton } from '@/lib/catalog-ui';
import { List, X } from 'lucide-solid';
import { TokenControlPanel } from '@/shell/TokenControlPanel';

function ClusterChapterNav(props: {
  clusterId: NavClusterId;
  route: SandboxRoute;
  activeSection?: string;
  onNavigate?: () => void;
}) {
  const cluster = () => NAV_CLUSTERS.find((item) => item.id === props.clusterId)!;

  return (
    <nav class="flex flex-col gap-16 p-12" aria-label="Catalog navigation">
      <div class="px-8">
        <div class="text-11 font-semibold text-content-primary">{cluster().label}</div>
        <div class="mt-2 text-10 leading-snug text-content-muted">{cluster().description}</div>
      </div>

      <For each={cluster().routes}>
        {(routeId) => {
          const meta = ROUTE_META[routeId];
          const groups = () => PAGE_CATALOG[routeId];
          const routeActive = () => props.route === routeId;

          return (
            <section class="flex flex-col gap-6">
              <a
                href={sandboxHref(routeId)}
                class={cn(
                  'rounded-md px-8 py-5 text-12 no-underline transition-colors duration-(--duration-fast)',
                  routeActive()
                    ? 'bg-sidebar-selected font-semibold text-content-primary'
                    : 'text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
                )}
                onClick={() => props.onNavigate?.()}
              >
                <span class="text-10 text-content-faint">{meta.tier}</span>
                <span class="ml-6">{meta.label}</span>
              </a>

              <Show when={routeActive()}>
                <For each={groups()}>
                  {(group) => (
                    <div class="pl-8">
                      <Show when={group.title}>
                        <div class="px-8 pb-3 text-10 font-medium tracking-caps uppercase text-content-faint">
                          {group.title}
                        </div>
                      </Show>
                      <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
                        <For each={group.items}>
                          {(item) => (
                            <li>
                              <a
                                href={sandboxHref(routeId, item.id)}
                                class={cn(
                                  'block rounded-md px-8 py-5 text-12 no-underline transition-colors duration-(--duration-fast)',
                                  props.activeSection === item.id
                                    ? 'bg-accent-soft font-medium text-content-primary'
                                    : item.status === 'not-implemented'
                                      ? 'text-content-faint hover:bg-interaction-hover hover:text-content-muted'
                                      : 'text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
                                )}
                                onClick={() => props.onNavigate?.()}
                              >
                                <span>{item.label}</span>
                                <Show when={item.status === 'not-implemented'}>
                                  <span class="ml-6 text-10 text-content-faint">不实现</span>
                                </Show>
                              </a>
                            </li>
                          )}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </Show>
            </section>
          );
        }}
      </For>
    </nav>
  );
}

export function SandboxShell(props: { children: unknown }) {
  const [route, setRoute] = createSignal(parseSandboxHash().route);
  const [section, setSection] = createSignal(parseSandboxHash().section);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const clusterId = () => clusterForRoute(route());

  const syncHash = () => {
    const parsed = parseSandboxHash();
    setRoute(parsed.route);
    setSection(parsed.section);
    if (parsed.section) scrollToSection(parsed.section);
    setDrawerOpen(false);
  };

  onMount(() => {
    syncHash();
    window.addEventListener('hashchange', syncHash);
    onCleanup(() => window.removeEventListener('hashchange', syncHash));
  });

  createEffect(() => {
    const id = section();
    if (id) scrollToSection(id);
  });

  const clusterTabClass = (active: boolean) =>
    cn(
      'relative flex-none rounded-md px-12 py-8 text-13 no-underline transition-colors duration-(--duration-fast)',
      active ? 'bg-accent-soft font-medium text-content-primary' : 'text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
    );

  return (
    <div class="sandbox-app">
      <header class="sandbox-header">
        <div class="flex min-h-48 items-center gap-12 px-16">
          <div class="min-w-0 flex-1">
            <div class="text-14 font-semibold tracking-tight text-content-primary">Peri Studio</div>
            <div class="text-10 text-content-muted">UI Catalog</div>
          </div>
          <IconButton
            label="Open section menu"
            class="sandbox-chapters-trigger shrink-0"
            onClick={() => setDrawerOpen(true)}
          >
            <List size={18} />
          </IconButton>
        </div>
        <nav class="flex gap-4 overflow-x-auto px-12 pb-12" aria-label="Catalog tiers">
          <For each={NAV_CLUSTERS}>
            {(cluster) => {
              const active = () => clusterId() === cluster.id;
              const href = sandboxHref(defaultRouteForCluster(cluster.id));
              return (
                <a href={href} class={clusterTabClass(active())} aria-current={active() ? 'page' : undefined}>
                  <span class="text-10 text-content-faint">{cluster.tier}</span>
                  <span class="ml-4">{cluster.label}</span>
                </a>
              );
            }}
          </For>
        </nav>
      </header>

      <div class="sandbox-frame">
        <aside class="sandbox-chapters sandbox-chapters-desktop" aria-label="Section navigation">
          <ClusterChapterNav
            clusterId={clusterId()}
            route={route()}
            activeSection={section()}
          />
        </aside>

        <main class="sandbox-main">{props.children as never}</main>
      </div>

      <Show when={drawerOpen()}>
        <div class="sandbox-drawer-root" role="presentation">
          <button
            type="button"
            class="sandbox-drawer-backdrop"
            aria-label="Close section menu"
            onClick={() => setDrawerOpen(false)}
          />
          <aside class="sandbox-chapters sandbox-chapters-drawer" aria-label="Section navigation">
            <div class="flex items-center justify-between border-b border-border-subtle px-12 py-8">
              <span class="text-12 font-medium text-content-primary">Catalog</span>
              <IconButton label="Close section menu" size="sm" onClick={() => setDrawerOpen(false)}>
                <X size={16} />
              </IconButton>
            </div>
            <ClusterChapterNav
              clusterId={clusterId()}
              route={route()}
              activeSection={section()}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      </Show>

      <TokenControlPanel />
    </div>
  );
}
