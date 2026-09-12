import { ArrowLeft, ArrowRight } from 'lucide-solid';
import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  useContext,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { IconButton } from './Button';

type CarouselOrientation = 'horizontal' | 'vertical';
type CarouselEvent = 'select' | 'reInit';

export type CarouselApi = {
  scrollPrev: () => void;
  scrollNext: () => void;
  scrollTo: (index: number) => void;
  canScrollPrev: () => boolean;
  canScrollNext: () => boolean;
  selectedScrollSnap: () => number;
  scrollSnapList: () => number[];
  on: (event: CarouselEvent, callback: () => void) => void;
  off: (event: CarouselEvent, callback: () => void) => void;
};

type CarouselOptions = {
  align?: 'start' | 'center' | 'end';
  loop?: boolean;
};

type CarouselProps = {
  orientation?: CarouselOrientation;
  opts?: CarouselOptions;
  setApi?: (api: CarouselApi) => void;
};

type CarouselContextValue = {
  orientation: () => CarouselOrientation;
  viewportRef: (node: HTMLDivElement | undefined) => void;
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: () => boolean;
  canScrollNext: () => boolean;
  api: CarouselApi;
};

const CarouselContext = createContext<CarouselContextValue>();

function useCarousel(component: string) {
  const context = useContext(CarouselContext);
  if (!context) {
    throw new Error(`${component} must be used within Carousel`);
  }
  return context;
}

function createCarouselEventEmitter() {
  const listeners = new Map<CarouselEvent, Set<() => void>>();

  return {
    on(event: CarouselEvent, callback: () => void) {
      const bucket = listeners.get(event) ?? new Set<() => void>();
      bucket.add(callback);
      listeners.set(event, bucket);
    },
    off(event: CarouselEvent, callback: () => void) {
      listeners.get(event)?.delete(callback);
    },
    emit(event: CarouselEvent) {
      listeners.get(event)?.forEach((callback) => callback());
    },
  };
}

function getCarouselItems(viewport: HTMLDivElement) {
  return Array.from(
    viewport.querySelectorAll<HTMLElement>('[data-slot="carousel-item"]'),
  );
}

function getSelectedIndex(viewport: HTMLDivElement, orientation: CarouselOrientation) {
  const items = getCarouselItems(viewport);
  if (items.length === 0) return 0;

  const scrollPos =
    orientation === 'horizontal' ? viewport.scrollLeft : viewport.scrollTop;
  let closest = 0;
  let minDistance = Number.POSITIVE_INFINITY;

  items.forEach((item, index) => {
    const itemPos = orientation === 'horizontal' ? item.offsetLeft : item.offsetTop;
    const distance = Math.abs(scrollPos - itemPos);
    if (distance < minDistance) {
      minDistance = distance;
      closest = index;
    }
  });

  return closest;
}

function scrollItemIntoView(
  viewport: HTMLDivElement,
  index: number,
  orientation: CarouselOrientation,
) {
  const items = getCarouselItems(viewport);
  const item = items[index];
  if (!item) return;

  item.scrollIntoView({
    behavior: 'smooth',
    block: orientation === 'horizontal' ? 'nearest' : 'start',
    inline: orientation === 'horizontal' ? 'start' : 'nearest',
  });
}

function createCarouselApi(
  getViewport: () => HTMLDivElement | undefined,
  orientation: () => CarouselOrientation,
  loop: () => boolean,
  onStateChange: () => void,
): CarouselApi {
  const events = createCarouselEventEmitter();

  const withViewport = (action: (viewport: HTMLDivElement) => void) => {
    const viewport = getViewport();
    if (!viewport) return;
    action(viewport);
    onStateChange();
    events.emit('select');
  };

  return {
    scrollPrev: () => {
      withViewport((viewport) => {
        const items = getCarouselItems(viewport);
        if (items.length === 0) return;
        const current = getSelectedIndex(viewport, orientation());
        const previous = loop()
          ? (current - 1 + items.length) % items.length
          : Math.max(0, current - 1);
        scrollItemIntoView(viewport, previous, orientation());
      });
    },
    scrollNext: () => {
      withViewport((viewport) => {
        const items = getCarouselItems(viewport);
        if (items.length === 0) return;
        const current = getSelectedIndex(viewport, orientation());
        const next = loop()
          ? (current + 1) % items.length
          : Math.min(items.length - 1, current + 1);
        scrollItemIntoView(viewport, next, orientation());
      });
    },
    scrollTo: (index) => {
      withViewport((viewport) => {
        const items = getCarouselItems(viewport);
        if (items.length === 0) return;
        const clamped = Math.max(0, Math.min(items.length - 1, index));
        scrollItemIntoView(viewport, clamped, orientation());
      });
    },
    canScrollPrev: () => {
      const viewport = getViewport();
      if (!viewport) return false;
      if (loop()) return getCarouselItems(viewport).length > 1;
      return getSelectedIndex(viewport, orientation()) > 0;
    },
    canScrollNext: () => {
      const viewport = getViewport();
      if (!viewport) return false;
      const items = getCarouselItems(viewport);
      if (items.length === 0) return false;
      if (loop()) return items.length > 1;
      return getSelectedIndex(viewport, orientation()) < items.length - 1;
    },
    selectedScrollSnap: () => {
      const viewport = getViewport();
      if (!viewport) return 0;
      return getSelectedIndex(viewport, orientation());
    },
    scrollSnapList: () => {
      const viewport = getViewport();
      if (!viewport) return [];
      return getCarouselItems(viewport).map((_, index) => index);
    },
    on: events.on,
    off: events.off,
  };
}

/** 轮播根容器：键盘导航、region 语义与 CarouselApi 上下文。 */
export const Carousel: Component<ComponentProps<'div'> & CarouselProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'orientation',
    'opts',
    'setApi',
    'role',
    'aria-roledescription',
    'aria-label',
    'tabIndex',
  ]);

  const orientation = () => local.orientation ?? 'horizontal';
  const loop = () => local.opts?.loop ?? false;
  const [viewport, setViewport] = createSignal<HTMLDivElement | undefined>();
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [itemCount, setItemCount] = createSignal(0);

  const syncFromViewport = () => {
    const node = viewport();
    if (!node) return;
    setSelectedIndex(getSelectedIndex(node, orientation()));
    setItemCount(getCarouselItems(node).length);
  };

  const api = createCarouselApi(viewport, orientation, loop, syncFromViewport);

  createEffect(() => {
    const node = viewport();
    if (!node) return;

    const handleScroll = () => syncFromViewport();
    const handleResize = () => syncFromViewport();

    node.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    syncFromViewport();
    api.on('reInit', syncFromViewport);

    onCleanup(() => {
      node.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      api.off('reInit', syncFromViewport);
    });
  });

  createEffect(() => {
    local.setApi?.(api);
  });

  const canScrollPrev = () => {
    if (loop()) return itemCount() > 1;
    return selectedIndex() > 0;
  };

  const canScrollNext = () => {
    if (loop()) return itemCount() > 1;
    return itemCount() > 0 && selectedIndex() < itemCount() - 1;
  };

  const scrollPrev = () => api.scrollPrev();
  const scrollNext = () => api.scrollNext();

  const handleKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (typeof rest.onKeyDown === 'function') {
      rest.onKeyDown(event);
    }
    if (event.defaultPrevented) return;

    const key = event.key;
    if (
      key === 'ArrowLeft' ||
      (orientation() === 'vertical' && key === 'ArrowUp')
    ) {
      event.preventDefault();
      scrollPrev();
      return;
    }

    if (
      key === 'ArrowRight' ||
      (orientation() === 'vertical' && key === 'ArrowDown')
    ) {
      event.preventDefault();
      scrollNext();
    }
  };

  const contextValue: CarouselContextValue = {
    orientation,
    viewportRef: setViewport,
    scrollPrev,
    scrollNext,
    canScrollPrev,
    canScrollNext,
    api: api,
  };

  return (
    <CarouselContext.Provider value={contextValue}>
      <div
        role={local.role ?? 'region'}
        aria-roledescription={local['aria-roledescription'] ?? 'carousel'}
        aria-label={local['aria-label'] ?? 'Carousel'}
        tabIndex={local.tabIndex ?? 0}
        data-slot="carousel"
        class={cn('relative', local.class)}
        {...rest}
        onKeyDown={handleKeyDown}
      >
        {local.children}
      </div>
    </CarouselContext.Provider>
  );
};

/** 可滚动视口：scroll-snap 对齐子项。 */
export const CarouselContent: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const { orientation, viewportRef } = useCarousel('CarouselContent');
  const isHorizontal = () => orientation() === 'horizontal';

  return (
    <div data-slot="carousel-content" class="overflow-hidden">
      <div
        ref={viewportRef}
        data-slot="carousel-viewport"
        class={cn(
          'flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          isHorizontal()
            ? '-ml-16 snap-x snap-mandatory overflow-x-auto'
            : '-mt-16 snap-y snap-mandatory flex-col overflow-y-auto',
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </div>
    </div>
  );
};

/** 单个轮播页。 */
export const CarouselItem: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'role', 'aria-roledescription']);
  const { orientation } = useCarousel('CarouselItem');
  const isHorizontal = () => orientation() === 'horizontal';

  return (
    <div
      role={local.role ?? 'group'}
      aria-roledescription={local['aria-roledescription'] ?? 'slide'}
      data-slot="carousel-item"
      class={cn(
        'min-w-0 shrink-0 grow-0 basis-full snap-start',
        isHorizontal() ? 'pl-16' : 'pt-16',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 上一页按钮。 */
export const CarouselPrevious: Component<ComponentProps<'button'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const { orientation, scrollPrev, canScrollPrev } = useCarousel('CarouselPrevious');
  const isHorizontal = () => orientation() === 'horizontal';

  return (
    <IconButton
      type="button"
      variant="default"
      size="sm"
      label="Previous slide"
      showTooltip={false}
      data-slot="carousel-previous"
      class={cn(
        'absolute size-32',
        isHorizontal()
          ? 'top-1/2 -left-12 -translate-y-1/2'
          : '-top-12 left-1/2 -translate-x-1/2 rotate-90',
        local.class,
      )}
      disabled={!canScrollPrev()}
      onClick={() => scrollPrev()}
      {...rest}
    >
      <ArrowLeft size={16} strokeWidth={1.7} class="shrink-0" aria-hidden="true" />
    </IconButton>
  );
};

/** 下一页按钮。 */
export const CarouselNext: Component<ComponentProps<'button'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const { orientation, scrollNext, canScrollNext } = useCarousel('CarouselNext');
  const isHorizontal = () => orientation() === 'horizontal';

  return (
    <IconButton
      type="button"
      variant="default"
      size="sm"
      label="Next slide"
      showTooltip={false}
      data-slot="carousel-next"
      class={cn(
        'absolute size-32',
        isHorizontal()
          ? 'top-1/2 -right-12 -translate-y-1/2'
          : '-bottom-12 left-1/2 -translate-x-1/2 rotate-90',
        local.class,
      )}
      disabled={!canScrollNext()}
      onClick={() => scrollNext()}
      {...rest}
    >
      <ArrowRight size={16} strokeWidth={1.7} class="shrink-0" aria-hidden="true" />
    </IconButton>
  );
};

export { useCarousel };
