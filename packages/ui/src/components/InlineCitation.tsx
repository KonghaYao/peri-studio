import { ArrowLeft, ArrowRight } from 'lucide-solid';
import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from './Carousel';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './HoverCard';

/** 行内引用根容器，与正文同排。 */
export const InlineCitation: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <span
      data-slot="inline-citation"
      class={cn('group inline items-center gap-4', local.class)}
      {...rest}
    >
      {local.children}
    </span>
  );
};

export const InlineCitationText: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <span
      data-slot="inline-citation-text"
      class={cn('transition-colors group-hover:bg-interaction-hover', local.class)}
      {...rest}
    >
      {local.children}
    </span>
  );
};

export const InlineCitationCard: Component<ComponentProps<typeof HoverCard>> = (props) => (
  <HoverCard openDelay={0} closeDelay={0} {...props} />
);

function formatCitationHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

type InlineCitationCardTriggerProps = ComponentProps<'span'> & {
  sources: string[];
};

export const InlineCitationCardTrigger: Component<InlineCitationCardTriggerProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'sources', 'children']);
  const primarySource = () => local.sources[0];
  const extraCount = () => Math.max(0, local.sources.length - 1);

  return (
    <HoverCardTrigger
      as="button"
      type="button"
      data-slot="inline-citation-card-trigger"
      class={cn(
        'ml-4 inline-flex cursor-pointer items-center rounded-full border border-border-strong bg-surface-overlay px-8 py-2 text-11 font-medium text-text-secondary outline-none transition-colors duration-120 hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2',
        local.class,
      )}
      {...rest}
    >
      {local.children ?? (
        <>
          {primarySource() ? (
            <>
              {formatCitationHostname(primarySource()!)}
              {extraCount() > 0 ? ` +${extraCount()}` : ''}
            </>
          ) : (
            'unknown'
          )}
        </>
      )}
    </HoverCardTrigger>
  );
};

export const InlineCitationCardBody: Component<ComponentProps<'div'> & { class?: string }> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <HoverCardContent
      data-slot="inline-citation-card-body"
      class={cn('relative w-(--container-popover) max-w-full p-0', local.class)}
      {...rest}
    >
      {local.children}
    </HoverCardContent>
  );
};

const InlineCitationCarouselApiContext = createContext<Accessor<CarouselApi | undefined>>();

function useInlineCitationCarouselApi(component: string) {
  const context = useContext(InlineCitationCarouselApiContext);
  if (!context) {
    throw new Error(`${component} must be used within InlineCitationCarousel`);
  }
  return context;
}

type InlineCitationCarouselProps = ComponentProps<typeof Carousel>;

export const InlineCitationCarousel: Component<InlineCitationCarouselProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'setApi']);
  const [api, setApi] = createSignal<CarouselApi | undefined>();

  const handleSetApi = (next: CarouselApi) => {
    setApi(next);
    local.setApi?.(next);
  };

  return (
    <InlineCitationCarouselApiContext.Provider value={api}>
      <Carousel
        data-slot="inline-citation-carousel"
        class={cn('w-full', local.class)}
        setApi={handleSetApi}
        {...rest}
      >
        {local.children}
      </Carousel>
    </InlineCitationCarouselApiContext.Provider>
  );
};

export const InlineCitationCarouselContent: Component<ComponentProps<'div'>> = (props) => (
  <CarouselContent data-slot="inline-citation-carousel-content" {...props} />
);

export const InlineCitationCarouselItem: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <CarouselItem class={cn('w-full space-y-8 p-16 pl-32', local.class)} {...rest}>
      <div data-slot="inline-citation-carousel-item">{local.children}</div>
    </CarouselItem>
  );
};

export const InlineCitationCarouselHeader: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <div
      data-slot="inline-citation-carousel-header"
      class={cn(
        'flex items-center justify-between gap-8 rounded-t-6 bg-surface-overlay px-8 py-8',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </div>
  );
};

export const InlineCitationCarouselIndex: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  const api = useInlineCitationCarouselApi('InlineCitationCarouselIndex');
  const [current, setCurrent] = createSignal(0);
  const [count, setCount] = createSignal(0);

  createEffect(() => {
    const carousel = api();
    if (!carousel) return;

    const syncState = () => {
      const snaps = carousel.scrollSnapList();
      setCount(snaps.length);
      setCurrent(snaps.length === 0 ? 0 : carousel.selectedScrollSnap() + 1);
    };

    syncState();
    queueMicrotask(syncState);
    const frame = requestAnimationFrame(syncState);

    carousel.on('select', syncState);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      carousel.off('select', syncState);
    });
  });

  return (
    <div
      data-slot="inline-citation-carousel-index"
      class={cn(
        'flex flex-1 items-center justify-end px-12 py-4 text-11 text-content-muted',
        local.class,
      )}
      {...rest}
    >
      {local.children ?? `${current()}/${count()}`}
    </div>
  );
};

export const InlineCitationCarouselPrev: Component<ComponentProps<'button'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'onClick']);
  const api = useInlineCitationCarouselApi('InlineCitationCarouselPrev');

  const handleClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (event) => {
    api()?.scrollPrev();
    if (typeof local.onClick === 'function') {
      local.onClick(event);
    }
  };

  return (
    <button
      type="button"
      aria-label="Previous"
      data-slot="inline-citation-carousel-prev"
      class={cn('shrink-0 border-0 bg-transparent p-0 outline-none', local.class)}
      onClick={handleClick}
      {...rest}
    >
      <ArrowLeft size={16} strokeWidth={1.7} class="text-content-muted" aria-hidden="true" />
    </button>
  );
};

export const InlineCitationCarouselNext: Component<ComponentProps<'button'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'onClick']);
  const api = useInlineCitationCarouselApi('InlineCitationCarouselNext');

  const handleClick: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent> = (event) => {
    api()?.scrollNext();
    if (typeof local.onClick === 'function') {
      local.onClick(event);
    }
  };

  return (
    <button
      type="button"
      aria-label="Next"
      data-slot="inline-citation-carousel-next"
      class={cn('shrink-0 border-0 bg-transparent p-0 outline-none', local.class)}
      onClick={handleClick}
      {...rest}
    >
      <ArrowRight size={16} strokeWidth={1.7} class="text-content-muted" aria-hidden="true" />
    </button>
  );
};

type InlineCitationSourceProps = ComponentProps<'div'> & {
  title?: string;
  url?: string;
  description?: string;
};

export const InlineCitationSource: Component<InlineCitationSourceProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'title', 'url', 'description', 'children']);
  return (
    <div data-slot="inline-citation-source" class={cn('space-y-4', local.class)} {...rest}>
      {local.title && (
        <h4 class="truncate text-13 font-medium leading-tight text-content-primary">{local.title}</h4>
      )}
      {local.url && <p class="truncate break-all text-11 text-content-muted">{local.url}</p>}
      {local.description && (
        <p class="ui-line-clamp-2 text-12 leading-relaxed text-content-muted">{local.description}</p>
      )}
      {local.children}
    </div>
  );
};

/** 引用摘录块。 */
export const InlineCitationQuote: Component<ComponentProps<'blockquote'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <blockquote
      data-slot="inline-citation-quote"
      class={cn(
        'm-0 border-l-2 border-border-strong pl-10 text-12 leading-normal text-content-muted italic',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </blockquote>
  );
};
