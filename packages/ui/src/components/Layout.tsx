import {
  createContext,
  createUniqueId,
  onCleanup,
  onMount,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
} from 'solid-js';
import { cn } from '../lib/cn';
import { createControllableSignal } from '../lib/controllable-state';

interface LayoutContextValue {
  registerSider: (id: string) => void;
  unregisterSider: (id: string) => void;
}

const LayoutContext = createContext<LayoutContextValue>();

type LayoutProps = ComponentProps<'div'> & {
  hasSider?: boolean;
};

function LayoutRoot(props: LayoutProps) {
  const [local, rest] = splitProps(props, ['class', 'children', 'hasSider']);
  const siders = new Set<string>();

  const context: LayoutContextValue = {
    registerSider: (id) => siders.add(id),
    unregisterSider: (id) => siders.delete(id),
  };

  const hasSider = () => local.hasSider ?? siders.size > 0;

  return (
    <LayoutContext.Provider value={context}>
      <div
        data-slot="layout"
        class={cn(
          'ui-layout flex min-h-0 min-w-0 flex-auto flex-col bg-surface',
          hasSider() && 'ui-layout-has-sider flex-row',
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </div>
    </LayoutContext.Provider>
  );
}

export const LayoutHeader: Component<ComponentProps<'header'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <header
      data-slot="layout-header"
      class={cn(
        'ui-layout-header shrink-0 border-b border-border-subtle bg-surface px-16 py-12 text-13 text-content-primary',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </header>
  );
};

export const LayoutFooter: Component<ComponentProps<'footer'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <footer
      data-slot="layout-footer"
      class={cn(
        'ui-layout-footer shrink-0 border-t border-border-subtle bg-surface px-16 py-12 text-13 text-content-secondary',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </footer>
  );
};

export const LayoutContent: Component<ComponentProps<'main'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <main
      data-slot="layout-content"
      class={cn('ui-layout-content min-h-0 min-w-0 flex-auto p-16', local.class)}
      {...rest}
    >
      {local.children}
    </main>
  );
};

type SiderTheme = 'light' | 'dark';

type LayoutSiderProps = ComponentProps<'aside'> & {
  width?: number | string;
  collapsedWidth?: number | string;
  collapsible?: boolean;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
  theme?: SiderTheme;
  reverseArrow?: boolean;
};

export const LayoutSider: Component<LayoutSiderProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'width',
    'collapsedWidth',
    'collapsible',
    'collapsed',
    'defaultCollapsed',
    'onCollapse',
    'theme',
    'reverseArrow',
    'style',
  ]);
  const layout = useContext(LayoutContext);
  const siderId = createUniqueId();

  onMount(() => {
    layout?.registerSider(siderId);
    onCleanup(() => layout?.unregisterSider(siderId));
  });

  const [collapsed, setCollapsed] = createControllableSignal<boolean>({
    prop: () => local.collapsed,
    defaultProp: local.defaultCollapsed ?? false,
    onChange: local.onCollapse,
  });

  const width = () => {
    const expanded = typeof local.width === 'number' ? `${local.width}px` : (local.width ?? '200px');
    const collapsedValue =
      typeof local.collapsedWidth === 'number'
        ? `${local.collapsedWidth}px`
        : (local.collapsedWidth ?? '80px');
    return collapsed() ? collapsedValue : expanded;
  };

  const theme = () => local.theme ?? 'light';

  return (
    <aside
      data-slot="layout-sider"
      data-collapsed={collapsed() ? 'true' : 'false'}
      data-theme={theme()}
      class={cn(
        'ui-layout-sider relative shrink-0 border-r border-border-subtle transition-[width] duration-base',
        theme() === 'dark' ? 'bg-neutral-900 text-content-on-accent' : 'bg-surface-sunken text-content-primary',
        local.class,
      )}
      style={{
        width: width(),
        ...(typeof local.style === 'object' && local.style !== null ? local.style : {}),
      }}
      {...rest}
    >
      <div class="ui-layout-sider-children h-full overflow-auto p-12">{local.children}</div>
      {local.collapsible && (
        <button
          type="button"
          class="absolute inset-y-0 -right-12 z-1 flex w-12 items-center justify-center border border-border-subtle bg-surface text-10 text-content-muted hover:text-content-primary"
          aria-label={collapsed() ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed(!collapsed())}
        >
          {collapsed() ? (local.reverseArrow ? '›' : '‹') : local.reverseArrow ? '‹' : '›'}
        </button>
      )}
    </aside>
  );
};

export const Layout = Object.assign(LayoutRoot, {
  Header: LayoutHeader,
  Sider: LayoutSider,
  Content: LayoutContent,
  Footer: LayoutFooter,
});
