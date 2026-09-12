import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackToTop } from '../src/components/BackToTop';

afterEach(() => cleanup());

describe('BackToTop', () => {
  it('renders a pill button with muted label color', () => {
    render(() => <BackToTop visible onClick={() => undefined} />);

    const button = screen.getByRole('button', { name: 'Back to latest' });
    expect(button).toHaveClass('ui-back-to-top__button');
    expect(button.closest('[data-slot="back-to-top"]')).toHaveAttribute('data-direction', 'end');
  });

  it('uses custom label and start direction', () => {
    render(() => (
      <BackToTop visible direction="start" label="Back to top" onClick={() => undefined} />
    ));

    expect(screen.getByRole('button', { name: 'Back to top' })).toBeInTheDocument();
    expect(screen.getByRole('button').closest('[data-slot="back-to-top"]')).toHaveAttribute(
      'data-direction',
      'start',
    );
  });

  it('hides interaction when not visible', () => {
    render(() => <BackToTop visible={false} onClick={() => undefined} />);

    const shell = document.querySelector('[data-slot="back-to-top"]');
    expect(shell).toHaveAttribute('data-visible', 'false');
    expect(screen.getByRole('button', { hidden: true })).toHaveAttribute('aria-hidden', 'true');
  });

  it('calls onClick when activated', () => {
    const onClick = vi.fn();
    render(() => <BackToTop visible onClick={onClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to latest' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
