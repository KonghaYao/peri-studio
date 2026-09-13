import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '../src/components/MessageScroller';

afterEach(() => cleanup());

function mockScrollableElement(element: HTMLElement, size: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => size.scrollHeight,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => size.clientHeight,
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    writable: true,
    value: 0,
  });
}

function renderTranscript(messages: string[] = ['Hello', 'World']) {
  return render(() => (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller class="h-80">
        <MessageScrollerViewport>
          <MessageScrollerContent>
            <For each={messages}>
              {(message, index) => (
                <MessageScrollerItem messageId={`msg-${index()}`} scrollAnchor={index() === 0}>
                  <p>{message}</p>
                </MessageScrollerItem>
              )}
            </For>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  ));
}

describe('MessageScroller', () => {
  it('renders region and log semantics with scroll-fade viewport', () => {
    renderTranscript();

    const viewport = screen.getByRole('region', { name: 'Messages' });
    expect(viewport).toHaveAttribute('data-slot', 'message-scroller-viewport');
    expect(viewport).toHaveClass('scroll-fade-b', 'ui-scrollbar');
    expect(viewport).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('log')).toHaveAttribute('data-slot', 'message-scroller-content');
  });

  it('registers transcript rows with message ids', () => {
    renderTranscript(['Alpha', 'Beta']);

    const items = document.querySelectorAll('[data-slot="message-scroller-item"]');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('data-message-id', 'msg-0');
    expect(items[0]).toHaveAttribute('data-scroll-anchor', 'true');
    expect(items[1]).toHaveAttribute('data-message-id', 'msg-1');
  });

  it('exposes scroll commands through useMessageScroller', () => {
    const scrollTo = vi.fn();

    render(() => (
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport
            ref={(node) => {
              if (!node) return;
              mockScrollableElement(node, { scrollHeight: 400, clientHeight: 200 });
              node.scrollTo = scrollTo;
            }}
          >
            <MessageScrollerContent>
              <MessageScrollerItem messageId="one">
                <p>One</p>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <ScrollControls />
        </MessageScroller>
      </MessageScrollerProvider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
    expect(scrollTo).toHaveBeenCalled();
  });

  it('scrolls to the maximum scroll top when jumping to end', async () => {
    let scrollTop = 0;

    render(() => (
      <MessageScrollerProvider autoScroll={false}>
        <MessageScroller>
          <MessageScrollerViewport
            ref={(node) => {
              if (!node) return;
              mockScrollableElement(node, { scrollHeight: 400, clientHeight: 200 });
              Object.defineProperty(node, 'scrollTop', {
                configurable: true,
                get: () => scrollTop,
                set: (value) => {
                  scrollTop = value;
                },
              });
            }}
          >
            <MessageScrollerContent>
              <MessageScrollerItem messageId="one">
                <p>One</p>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    ));

    const viewport = screen.getByRole('region', { name: 'Messages' });
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    });
    scrollTop = 0;

    fireEvent.click(screen.getByRole('button', { name: 'Scroll to end' }));
    await waitFor(() => expect(scrollTop).toBe(200));
  });

  it('shows scroll button only when not at end', () => {
    render(() => (
      <MessageScrollerProvider autoScroll={false}>
        <MessageScroller>
          <MessageScrollerViewport
            ref={(node) => {
              if (!node) return;
              mockScrollableElement(node, { scrollHeight: 400, clientHeight: 200 });
              node.scrollTop = 0;
            }}
          >
            <MessageScrollerContent>
              <MessageScrollerItem messageId="one">
                <p>One</p>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    ));

    const button = screen.getByRole('button', { name: 'Scroll to end' });
    expect(button).toHaveAttribute('data-active', 'true');
  });
});

function ScrollControls() {
  const scroller = useMessageScroller();
  return (
    <button type="button" onClick={() => scroller.scrollToEnd()}>
      Jump
    </button>
  );
}
