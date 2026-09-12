import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerQueue } from '../src/components/composer/ComposerQueue';

afterEach(() => cleanup());

const items = [
  {
    id: 'queued-1',
    preview: 'Compare @src/api.ts with the uploaded copy.',
    hasAttachment: true,
  },
];

describe('ComposerQueue', () => {
  it('renders queue count and item preview', () => {
    render(() => <ComposerQueue items={items} />);

    expect(screen.getByTestId('composer-queue')).toHaveAttribute('data-slot', 'composer-queue');
    expect(screen.getByText('1 Queued')).toBeInTheDocument();
    expect(screen.getByText(items[0].preview)).toBeInTheDocument();
  });

  it('wires item action callbacks', () => {
    const onSendNow = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    const onMore = vi.fn();

    render(() => (
      <ComposerQueue
        items={items}
        onSendNow={onSendNow}
        onEdit={onEdit}
        onRemove={onRemove}
        onMore={onMore}
      />
    ));

    screen.getByRole('button', { name: 'Send now' }).click();
    screen.getByRole('button', { name: 'Edit queued message' }).click();
    screen.getByRole('button', { name: 'Remove from queue' }).click();
    screen.getByRole('button', { name: 'More queue actions' }).click();

    expect(onSendNow).toHaveBeenCalledWith('queued-1');
    expect(onEdit).toHaveBeenCalledWith('queued-1');
    expect(onRemove).toHaveBeenCalledWith('queued-1');
    expect(onMore).toHaveBeenCalledWith('queued-1');
  });
});
