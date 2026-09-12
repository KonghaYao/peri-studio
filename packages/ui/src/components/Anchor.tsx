import {
  createContext,
  createSignal,
  For,
  onCleanup,
  onMount,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Affix } from './Affix';

export type AnchorLinkItem = {
  key?: string | number;
  href: string;
  title: JSX.Element;
  children?: AnchorLinkItem[];
};

type AnchorContainer = Window | HTMLElement;

type AnchorContextValue = {
  activeLink: () => string | null;
  registerLink: (href: string) => void;
  unregisterLink: (href: string) => void;
  onLinkClick: (href: string, event: MouseEvent) => void;
};

const AnchorContext = createContext<AnchorContextValue>();

function getDefaultContainer(): AnchorContainer {
  return window;
}

function getOffsetTop(element: HTMLElement, container: AnchorContainer): number {
  const rect = element.getBoundingClientRect();
  if (container === window) {
    return rect.top + window.scrollY;
  }
  const containerRect = (container as HTMLElement).getBoundingClientRect();
  return rect.top - containerRect.top + (container as HTMLElement).scrollTop;
}

type AnchorProps = ComponentProps<'div'> & {
  items?: AnchorLinkItem[];
  offsetTop?: number;
  bounds?: number;
  affix?: boolean;
  targetOffset?: number;
  getContainer?: () => AnchorContainer;
  onChange?: (activeLink: string) => void;
  onClick?: (event: MouseEvent, link: { href: string; title: JSX.Element }) => void;
  direction?: 'vertical' | 'horizontal';
  replace?: boolean;
};

export const Anchor: Component<AnchorProps> = (props) => {
  const [local] = splitProps(props, [
    'class',
    'children',
    'items',
    'offsetTop',
    'bounds',
    'affix',
    'targetOffset',
    'getContainer',
    'onChange',
    'onClick',
    'direction',
    'replace',
  ]);

  const [activeLink, setActiveLink] = createSignal<string | null>(null);
  const links = new Set<string>();

  const getContainer = () => local.getContainer?.() ?? getDefaultContainer();
  const bounds = () => local.bounds ?? 5;
  const targetOffset = () => local.targetOffset ?? local.offsetTop ?? 0;

  const scrollToLink = (href: string) => {
    const id = href.replace(/^#/, '');
    const target = document.getElementById(id);
    const container = getContainer();
    if (!target) return;
    const top = getOffsetTop(target, container) - targetOffset();
    if (container === window) {
      window.scrollTo({ top, behavior: 'smooth' });
    } else {
      (container as HTMLElement).scrollTo({ top, behavior: 'smooth' });
    }
  };

  const updateActiveLink = () => {
    const container = getContainer();
    const sections = [...links]
      .map((href) => {
        const id = href.replace(/^#/, '');
        const element = document.getElementById(id);
        if (!element) return null;
        return { href, top: getOffsetTop(element, container) };
      })
      .filter((item): item is { href: string; top: number } => item !== null)
      .sort((a, b) => a.top - b.top);

    const scrollTop =
      container === window ? window.scrollY : (container as HTMLElement).scrollTop;
    const active =
      sections.filter((section) => scrollTop + bounds() >= section.top).pop()?.href ?? sections[0]?.href ?? null;

    if (active && active !== activeLink()) {
      setActiveLink(active);
      local.onChange?.(active);
    }
  };

  onMount(() => {
    const container = getContainer();
    const handler = () => requestAnimationFrame(updateActiveLink);
    handler();
    container.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler, { passive: true });
    onCleanup(() => {
      container.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    });
  });

  const context: AnchorContextValue = {
    activeLink,
    registerLink: (href) => links.add(href),
    unregisterLink: (href) => links.delete(href),
    onLinkClick: (href, event) => {
      event.preventDefault();
      const item = local.items?.find((entry) => entry.href === href);
      local.onClick?.(event, { href, title: item?.title ?? href });
      if (local.replace) {
        history.replaceState(null, '', href);
      } else {
        history.pushState(null, '', href);
      }
      scrollToLink(href);
    },
  };

  const direction = () => local.direction ?? 'vertical';
  const content = () => (
    <AnchorContext.Provider value={context}>
      <nav
        data-slot="anchor"
        data-direction={direction()}
        class={cn(
          'text-13',
          direction() === 'horizontal' ? 'flex flex-row gap-16' : 'flex flex-col gap-4',
          local.class,
        )}
      >
        <For each={local.items}>{(item) => <AnchorLink item={item} />}</For>
        {local.children}
      </nav>
    </AnchorContext.Provider>
  );

  if (local.affix === false) return content();

  return (
    <Affix offsetTop={local.offsetTop ?? 0}>
      {content()}
    </Affix>
  );
};

type AnchorLinkProps = {
  item: AnchorLinkItem;
  nested?: boolean;
};

const AnchorLink: Component<AnchorLinkProps> = (props) => {
  const context = useContext(AnchorContext);
  if (!context) throw new Error('AnchorLink must be used within Anchor');

  onMount(() => {
    context.registerLink(props.item.href);
    onCleanup(() => context.unregisterLink(props.item.href));
  });

  const isActive = () => context.activeLink() === props.item.href;

  return (
    <div data-slot="anchor-link" class={cn(props.nested && 'pl-12')}>
      <a
        href={props.item.href}
        data-active={isActive() ? 'true' : 'false'}
        class={cn(
          'block rounded-4 px-8 py-4 text-content-secondary transition-colors hover:text-accent-solid',
          isActive() && 'border-l-2 border-accent-solid bg-accent-soft pl-6 text-accent-solid',
        )}
        onClick={(event) => context.onLinkClick(props.item.href, event)}
      >
        {props.item.title}
      </a>
      <For each={props.item.children}>
        {(child) => <AnchorLink item={child} nested />}
      </For>
    </div>
  );
};

export { AnchorLink };
