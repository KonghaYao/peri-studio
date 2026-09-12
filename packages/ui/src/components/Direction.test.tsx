import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { DirectionProvider, useDirection } from './Direction';

afterEach(() => cleanup());

function DirectionConsumer() {
  const { direction, setDirection } = useDirection();
  return (
    <div>
      <span data-testid="direction-value">{direction()}</span>
      <button type="button" onClick={() => setDirection?.('rtl')}>
        Set RTL
      </button>
    </div>
  );
}

describe('Direction', () => {
  it('renders wrapper with dir attribute', () => {
    render(() => (
      <DirectionProvider direction="rtl" data-testid="provider">
        <span>Content</span>
      </DirectionProvider>
    ));

    const provider = screen.getByTestId('provider');
    expect(provider).toHaveAttribute('dir', 'rtl');
    expect(provider).toHaveAttribute('data-slot', 'direction-provider');
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('provides direction via context', () => {
    render(() => (
      <DirectionProvider direction="ltr">
        <DirectionConsumer />
      </DirectionProvider>
    ));

    expect(screen.getByTestId('direction-value')).toHaveTextContent('ltr');
  });

  it('supports uncontrolled direction updates through setDirection', () => {
    render(() => (
      <DirectionProvider data-testid="provider">
        <DirectionConsumer />
      </DirectionProvider>
    ));

    expect(screen.getByTestId('direction-value')).toHaveTextContent('ltr');
    fireEvent.click(screen.getByRole('button', { name: 'Set RTL' }));
    expect(screen.getByTestId('direction-value')).toHaveTextContent('rtl');
    expect(screen.getByTestId('provider')).toHaveAttribute('dir', 'rtl');
  });

  it('supports controlled direction via onDirectionChange', () => {
    const [direction, setDirection] = createSignal<'ltr' | 'rtl'>('ltr');
    render(() => (
      <DirectionProvider
        direction={direction()}
        onDirectionChange={setDirection}
        data-testid="provider"
      >
        <DirectionConsumer />
      </DirectionProvider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Set RTL' }));
    expect(screen.getByTestId('direction-value')).toHaveTextContent('rtl');
    expect(screen.getByTestId('provider')).toHaveAttribute('dir', 'rtl');
  });

  it('throws when useDirection is used outside provider', () => {
    expect(() => render(() => <DirectionConsumer />)).toThrow(
      'useDirection must be used within <DirectionProvider>.',
    );
  });
});
