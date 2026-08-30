import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { PAGE_CATALOG, parseSandboxHash, ROUTE_META, sandboxHref, scrollToSection, type SandboxRoute } from '@/catalog/page-sections';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui';
import { List, X } from 'lucide-solid';

function ChapterNav(props: { route: SandboxRoute; activeSection?: string; onNavigate?: () => void }) {
  const groups = () => PAGE_CATALOG[props.route];

  return (
    <nav class="flex flex-col gap-3 p-3" aria-label="Page sections">
      <For each={groups()}>
        {(group) => (
          <div>
            <Show when={group.title}>
              <div class="px-2 pb-1 text-10 font-medium tracking-caps uppercase text-content-faint">{group.title}</div>
            </Show>
            <ul class="flex flex-col gap-0.5">
              <For each={group.items}>
                {(item) => (
                  <li>
                    <a
                      href={sandboxHref(props.route, item.id)}
                      class={cn(
                        'block rounded-md px-2 py-1.5 text-12 no-underline transition-colors duration-(--duration-fast)',
                        props.activeSection === item.id
                          ? 'bg-sidebar-selected font-medium text-content-primary'
                          : 'text-content-secondary hover:bg-interaction-hover hover:text-content-primary',
                      )}
                      onClick={() => props.onNavigate?.()}
                    >
                      {item.label}
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </For>
    </nav>
  );
}

export function SandboxShell(props: { children: unknown }) {
  const [route, setRoute] = createSignal(parseSandboxHash().route);
  const [section, setSection] = createSignal(parseSandboxHash().section);
  const [drawerOpen, setDrawerOpen] = createSignal(false);

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

  const tabClass = (active: boolean) =>
    cn(
      'relative flex-none px-3 py-2.5 text-13 no-underline transition-colors duration-(--duration-fast)',
      active ? 'font-medium text-accent-solid' : 'text-content-secondary hover:text-content-primary',
    );

  return (
    <div class="sandbox-app">
      <header class="sandbox-header">
        <div class="flex min-h-12 items-center gap-3 px-4">
          <div class="min-w-0 flex-1">
            <div class="text-14 font-semibold tracking-tight text-content-primary">Peri Studio</div>
            <div class="text-10 text-content-muted">UI Sandbox</div>
          </div>
          <IconButton
            label="Open section menu"
            class="sandbox-chapters-trigger shrink-0"
            onClick={() => setDrawerOpen(true)}
          >
            <List size={18} />
          </IconButton>
        </div>
        <nav class="flex gap-1 overflow-x-auto border-t border-border-subtle px-3" aria-label="Tiers">
          <For each={(['tokens', 'components', 'blocks', 'layers'] as SandboxRoute[])}>
            {(id) => {
              const meta = ROUTE_META[id];
              const active = () => route() === id;
              return (
                <a href={sandboxHref(id)} class={tabClass(active())} aria-current={active() ? 'page' : undefined}>
                  <span class="text-10 text-content-faint">{meta.tier}</span>
                  <span class="ml-1">{meta.label}</span>
                  <Show when={active()}>
                    <span class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-solid" aria-hidden="true" />
                  </Show>
                </a>
              );
            }}
          </For>
        </nav>
      </header>

      <div class="sandbox-frame">
        <aside class="sandbox-chapters sandbox-chapters-desktop" aria-label="Section navigation">
          <ChapterNav route={route()} activeSection={section()} />
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
            <div class="flex items-center justify-between border-b border-border-subtle px-3 py-2">
              <span class="text-12 font-medium text-content-primary">Sections</span>
              <IconButton label="Close section menu" size="sm" onClick={() => setDrawerOpen(false)}>
                <X size={16} />
              </IconButton>
            </div>
            <ChapterNav route={route()} activeSection={section()} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      </Show>
    </div>
  );
}
