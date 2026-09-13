import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popconfirm } from './Popconfirm';

afterEach(() => cleanup());

describe('Popconfirm', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: HTMLElement) {
      const el = this;
      const left = Number(el.dataset.anchorLeft ?? 120);
      const top = Number(el.dataset.anchorTop ?? 240);
      const width = Number(el.dataset.anchorWidth ?? 72);
      const height = Number(el.dataset.anchorHeight ?? 28);
      return {
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  it('positions the portal content with a popper transform', async () => {
    render(() => (
      <Popconfirm
        title="Delete session?"
        description="This cannot be undone."
        variant="danger"
        size="sm"
        defaultOpen
      >
        Delete
      </Popconfirm>
    ));

    const dialog = await screen.findByRole('dialog');

    await waitFor(() => {
      const positioner = dialog.closest('[data-popper-positioner]') as HTMLElement | null;
      expect(positioner?.style.transform).toMatch(/translate3d\([^)]+\)/);
    });

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('w-fit', 'self-start');
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('border-transparent', 'bg-transparent');
  });

  it('keeps the anchor width to the trigger inside flex column layouts', async () => {
    render(() => (
      <div class="flex w-480 flex-col gap-16">
        <Popconfirm
          title="Delete session?"
          variant="danger"
          size="sm"
          defaultOpen
        >
          Delete
        </Popconfirm>
      </div>
    ));

    const trigger = screen.getByRole('button', { name: 'Delete' });
    const dialog = await screen.findByRole('dialog');
    const triggerRect = trigger.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();

    expect(Math.abs(dialogRect.left + dialogRect.width / 2 - (triggerRect.left + triggerRect.width / 2)))
      .toBeLessThan(triggerRect.width);
  });

  it('opens from the trigger click', async () => {
    render(() => (
      <Popconfirm title="Delete session?" variant="danger" size="sm" onConfirm={() => {}}>
        Delete
      </Popconfirm>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
