import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './Drawer';

afterEach(() => cleanup());

describe('Drawer', () => {
  it('renders open bottom drawer with swipe metadata and optional handle', async () => {
    render(() => (
      <Drawer open swipeDirection="down" showSwipeHandle>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Share link</DrawerTitle>
            <DrawerDescription>Anyone with the link can view.</DrawerDescription>
            <DrawerClose aria-label="Close share drawer" />
          </DrawerHeader>
          <DrawerFooter>
            <button type="button">Copy link</button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    ));

    const dialog = await waitFor(() => screen.getByRole('dialog', { name: 'Share link' }));
    expect(dialog).toHaveAttribute('data-swipe-direction', 'down');
    expect(dialog).toHaveAttribute('data-swipe-axis', 'y');
    expect(dialog).toHaveClass('bottom-0', 'rounded-t-8', 'data-[expanded]:slide-in-from-bottom');
    expect(document.querySelector('[data-drawer-overlay]')).toBeInTheDocument();
    expect(document.querySelector('[data-drawer-swipe-handle]')).toBeInTheDocument();
    expect(screen.getByText('Anyone with the link can view.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close share drawer' })).toBeInTheDocument();
  });

  it('exposes trigger dialog semantics before opening', () => {
    render(() => (
      <Drawer>
        <DrawerTrigger>Open drawer</DrawerTrigger>
        <DrawerContent>
          <DrawerTitle>Panel</DrawerTitle>
        </DrawerContent>
      </Drawer>
    ));

    const trigger = screen.getByRole('button', { name: 'Open drawer' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
