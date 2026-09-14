import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoRefreshIntervalControl } from './AutoRefreshIntervalControl';

afterEach(() => cleanup());

const OPTIONS = [0, 15_000, 30_000, 60_000];

describe('AutoRefreshIntervalControl', () => {
  it('shows current interval label on trigger', () => {
    render(() => (
      <AutoRefreshIntervalControl value={30_000} options={OPTIONS} onChange={() => undefined} />
    ));

    expect(screen.getByRole('button', { name: 'Auto-refresh interval' })).toHaveTextContent('30s');
  });

  it('uses custom labels when provided', () => {
    render(() => (
      <AutoRefreshIntervalControl
        value={0}
        options={[0, 5_000]}
        labels={{ 0: 'Paused', 5_000: '5 sec' }}
        onChange={() => undefined}
      />
    ));

    expect(screen.getByRole('button', { name: 'Auto-refresh interval' })).toHaveTextContent('Paused');
  });

  it('calls onChange when selecting an option', async () => {
    const onChange = vi.fn();
    render(() => (
      <AutoRefreshIntervalControl value={0} options={OPTIONS} onChange={onChange} />
    ));

    const trigger = screen.getByRole('button', { name: 'Auto-refresh interval' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const option = await screen.findByRole('menuitem', { name: '15s' });
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    expect(onChange).toHaveBeenCalledWith(15_000);
  });

  it('spins icon when value is active by default', () => {
    const { container } = render(() => (
      <AutoRefreshIntervalControl value={15_000} options={OPTIONS} onChange={() => undefined} />
    ));

    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('respects explicit spinning=false', () => {
    const { container } = render(() => (
      <AutoRefreshIntervalControl
        value={15_000}
        options={OPTIONS}
        spinning={false}
        onChange={() => undefined}
      />
    ));

    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('applies accent styling when interval is active', () => {
    render(() => (
      <AutoRefreshIntervalControl value={30_000} options={OPTIONS} onChange={() => undefined} />
    ));

    expect(screen.getByRole('button', { name: 'Auto-refresh interval' })).toHaveClass('text-accent-solid');
  });
});
