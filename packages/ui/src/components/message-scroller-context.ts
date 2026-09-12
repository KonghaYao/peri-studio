import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
} from 'solid-js';

export type MessageScrollerScrollPosition = 'start' | 'end' | 'last-anchor';

export type MessageScrollerScrollOptions = {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
};

export type MessageScrollerProviderProps = {
  autoScroll?: boolean;
  defaultScrollPosition?: MessageScrollerScrollPosition;
  scrollEdgeThreshold?: number;
  scrollMargin?: number;
  scrollPreviousItemPeek?: number;
};

type ItemRecord = {
  element: HTMLElement;
  scrollAnchor: boolean;
};

export type MessageScrollerContextValue = {
  autoScroll: Accessor<boolean>;
  scrollEdgeThreshold: Accessor<number>;
  scrollMargin: Accessor<number>;
  scrollPreviousItemPeek: Accessor<number>;
  registerViewport: (node: HTMLDivElement | undefined) => void;
  registerContent: (node: HTMLDivElement | undefined) => void;
  registerItem: (messageId: string, element: HTMLElement, scrollAnchor: boolean) => void;
  unregisterItem: (messageId: string) => void;
  scrollToMessage: (messageId: string, options?: MessageScrollerScrollOptions) => boolean;
  scrollToEnd: (options?: MessageScrollerScrollOptions) => boolean;
  scrollToStart: (options?: MessageScrollerScrollOptions) => boolean;
  isAtStart: Accessor<boolean>;
  isAtEnd: Accessor<boolean>;
  isFollowing: Accessor<boolean>;
  subscribeVisibility: () => void;
  unsubscribeVisibility: () => void;
  currentAnchorId: Accessor<string | null>;
  visibleMessageIds: Accessor<string[]>;
};

const MessageScrollerContext = createContext<MessageScrollerContextValue>();

function distanceFromBottom(viewport: HTMLElement) {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

function distanceFromTop(viewport: HTMLElement) {
  return viewport.scrollTop;
}

function isNearBottom(viewport: HTMLElement, threshold: number) {
  return distanceFromBottom(viewport) <= threshold;
}

function isNearTop(viewport: HTMLElement, threshold: number) {
  return distanceFromTop(viewport) <= threshold;
}

function getOrderedItems(content: HTMLElement | undefined) {
  if (!content) return [] as HTMLElement[];
  return Array.from(
    content.querySelectorAll<HTMLElement>('[data-slot="message-scroller-item"][data-message-id]'),
  );
}

function scrollElement(
  viewport: HTMLElement,
  top: number,
  options?: MessageScrollerScrollOptions,
) {
  if (typeof viewport.scrollTo === 'function') {
    viewport.scrollTo({
      top,
      behavior: options?.behavior ?? 'smooth',
    });
  } else {
    viewport.scrollTop = top;
  }
  return true;
}

export function createMessageScrollerContext(
  props: () => MessageScrollerProviderProps,
): MessageScrollerContextValue {
  const autoScroll = () => props().autoScroll ?? true;
  const scrollEdgeThreshold = () => props().scrollEdgeThreshold ?? 24;
  const scrollMargin = () => props().scrollMargin ?? 0;
  const scrollPreviousItemPeek = () => props().scrollPreviousItemPeek ?? 48;

  const [viewport, setViewport] = createSignal<HTMLDivElement | undefined>();
  const [content, setContent] = createSignal<HTMLDivElement | undefined>();
  const [isAtStart, setIsAtStart] = createSignal(true);
  const [isAtEnd, setIsAtEnd] = createSignal(true);
  const [isFollowing, setIsFollowing] = createSignal(autoScroll());
  const [currentAnchorId, setCurrentAnchorId] = createSignal<string | null>(null);
  const [visibleMessageIds, setVisibleMessageIds] = createSignal<string[]>([]);

  const items = new Map<string, ItemRecord>();
  let visibilitySubscribers = 0;
  let intersectionObserver: IntersectionObserver | undefined;
  let contentHeight = 0;
  let firstMessageId: string | undefined;
  let initialScrollApplied = false;

  const syncScrollState = () => {
    const node = viewport();
    if (!node) return;
    const threshold = scrollEdgeThreshold();
    const atStart = isNearTop(node, threshold);
    const atEnd = isNearBottom(node, threshold);
    setIsAtStart(atStart);
    setIsAtEnd(atEnd);
    if (autoScroll()) {
      setIsFollowing(atEnd);
    }
    updateAnchorState(node);
  };

  const updateAnchorState = (node: HTMLDivElement) => {
    const ordered = getOrderedItems(content());
    const scrollTop = node.scrollTop + scrollPreviousItemPeek();
    let anchorId: string | null = null;

    for (const element of ordered) {
      const messageId = element.dataset.messageId;
      if (!messageId || element.dataset.scrollAnchor !== 'true') continue;
      if (element.offsetTop <= scrollTop) {
        anchorId = messageId;
      }
    }

    setCurrentAnchorId(anchorId);
  };

  const updateVisibleMessages = () => {
    const node = viewport();
    if (!node || visibilitySubscribers === 0) return;

    const viewportRect = node.getBoundingClientRect();
    const ids: string[] = [];

    for (const element of getOrderedItems(content())) {
      const messageId = element.dataset.messageId;
      if (!messageId) continue;
      const rect = element.getBoundingClientRect();
      const intersects =
        rect.bottom >= viewportRect.top &&
        rect.top <= viewportRect.bottom &&
        rect.right >= viewportRect.left &&
        rect.left <= viewportRect.right;
      if (intersects) ids.push(messageId);
    }

    setVisibleMessageIds(ids);
  };

  const ensureVisibilityObserver = () => {
    const node = viewport();
    if (!node || visibilitySubscribers === 0) {
      intersectionObserver?.disconnect();
      intersectionObserver = undefined;
      return;
    }

    intersectionObserver?.disconnect();
    intersectionObserver = new IntersectionObserver(
      () => updateVisibleMessages(),
      { root: node, threshold: 0 },
    );

    for (const element of getOrderedItems(content())) {
      intersectionObserver.observe(element);
    }
    updateVisibleMessages();
  };

  const scrollToEnd = (options?: MessageScrollerScrollOptions) => {
    const node = viewport();
    if (!node) return false;
    if (autoScroll()) setIsFollowing(true);
    return scrollElement(node, node.scrollHeight, options);
  };

  const scrollToStart = (options?: MessageScrollerScrollOptions) => {
    const node = viewport();
    if (!node) return false;
    setIsFollowing(false);
    return scrollElement(node, 0, options);
  };

  const scrollToMessage = (messageId: string, options?: MessageScrollerScrollOptions) => {
    const item = items.get(messageId);
    const node = viewport();
    if (!item || !node) return false;

    const top = Math.max(0, item.element.offsetTop - scrollMargin());
    if (autoScroll() && isNearBottom(node, scrollEdgeThreshold())) {
      setIsFollowing(true);
    } else {
      setIsFollowing(false);
    }
    return scrollElement(node, top, options);
  };

  const scrollToLastAnchor = (options?: MessageScrollerScrollOptions) => {
    const ordered = getOrderedItems(content());
    let anchor: HTMLElement | undefined;
    for (const element of ordered) {
      if (element.dataset.scrollAnchor === 'true') {
        anchor = element;
      }
    }
    if (!anchor) return scrollToEnd(options);

    const node = viewport();
    if (!node) return false;
    const top = Math.max(0, anchor.offsetTop - scrollPreviousItemPeek() - scrollMargin());
    return scrollElement(node, top, options);
  };

  const applyInitialScroll = () => {
    if (initialScrollApplied) return;
    const node = viewport();
    const contentNode = content();
    if (!node || !contentNode || contentNode.childElementCount === 0) return;

    initialScrollApplied = true;
    const position = props().defaultScrollPosition ?? 'end';
    if (position === 'start') {
      scrollToStart({ behavior: 'auto' });
      return;
    }
    if (position === 'last-anchor') {
      scrollToLastAnchor({ behavior: 'auto' });
      return;
    }
    scrollToEnd({ behavior: 'auto' });
  };

  const handleContentResize = () => {
    const node = viewport();
    const contentNode = content();
    if (!node || !contentNode) return;

    const nextHeight = contentNode.scrollHeight;
    const delta = nextHeight - contentHeight;
    const ordered = getOrderedItems(contentNode);
    const nextFirstId = ordered[0]?.dataset.messageId;
    const prepended = !!nextFirstId && !!firstMessageId && nextFirstId !== firstMessageId && delta > 0;
    firstMessageId = nextFirstId;
    contentHeight = nextHeight;

    if (delta <= 0) {
      syncScrollState();
      return;
    }

    if (isFollowing() || (autoScroll() && isNearBottom(node, scrollEdgeThreshold()))) {
      scrollToEnd({ behavior: 'auto' });
      return;
    }

    if (prepended) {
      node.scrollTop += delta;
    }

    syncScrollState();
  };

  const handleNewAnchor = (element: HTMLElement) => {
    const node = viewport();
    if (!node) return;
    const top = Math.max(0, element.offsetTop - scrollPreviousItemPeek() - scrollMargin());
    scrollElement(node, top, { behavior: 'auto' });
    if (autoScroll()) {
      setIsFollowing(isNearBottom(node, scrollEdgeThreshold()));
    }
  };

  createEffect(() => {
    const node = viewport();
    if (!node) return;

    const onScroll = () => {
      syncScrollState();
      updateVisibleMessages();
    };

    const onWheel = () => {
      if (!autoScroll()) return;
      if (!isNearBottom(node, scrollEdgeThreshold())) {
        setIsFollowing(false);
      }
    };

    node.addEventListener('scroll', onScroll, { passive: true });
    node.addEventListener('wheel', onWheel, { passive: true });
    node.addEventListener('touchmove', onWheel, { passive: true });
    syncScrollState();

    onCleanup(() => {
      node.removeEventListener('scroll', onScroll);
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchmove', onWheel);
    });
  });

  createEffect(() => {
    const contentNode = content();
    if (!contentNode) return;

    contentHeight = contentNode.scrollHeight;
    firstMessageId = getOrderedItems(contentNode)[0]?.dataset.messageId;
    applyInitialScroll();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => handleContentResize());
    observer.observe(contentNode);

    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    ensureVisibilityObserver();
  });

  return {
    autoScroll,
    scrollEdgeThreshold,
    scrollMargin,
    scrollPreviousItemPeek,
    registerViewport: setViewport,
    registerContent: setContent,
    registerItem(messageId, element, scrollAnchor) {
      const previous = items.get(messageId);
      const isNew = !previous;
      items.set(messageId, { element, scrollAnchor });
      if (scrollAnchor && isNew && initialScrollApplied) {
        queueMicrotask(() => handleNewAnchor(element));
      }
      ensureVisibilityObserver();
    },
    unregisterItem(messageId) {
      items.delete(messageId);
      ensureVisibilityObserver();
    },
    scrollToMessage,
    scrollToEnd,
    scrollToStart,
    isAtStart,
    isAtEnd,
    isFollowing,
    subscribeVisibility() {
      visibilitySubscribers += 1;
      ensureVisibilityObserver();
    },
    unsubscribeVisibility() {
      visibilitySubscribers = Math.max(0, visibilitySubscribers - 1);
      if (visibilitySubscribers === 0) {
        intersectionObserver?.disconnect();
        intersectionObserver = undefined;
        setVisibleMessageIds([]);
      }
    },
    currentAnchorId,
    visibleMessageIds,
  };
}

export function useMessageScrollerContext(component: string) {
  const context = useContext(MessageScrollerContext);
  if (!context) {
    throw new Error(`${component} must be used within MessageScrollerProvider`);
  }
  return context;
}

export { MessageScrollerContext };
