import { cleanup, render, screen } from '@solidjs/testing-library';
import { ListIcon } from 'lucide-solid';
import { afterEach, describe, expect, it } from 'vitest';
import { StatChip } from './StatChip';

afterEach(() => cleanup());

describe('StatChip', () => {
  it('renders label and value', () => {
    render(() => <StatChip label="Duration" value="1.24s" data-testid="chip" />);
    expect(screen.getByTestId('chip')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('1.24s')).toBeInTheDocument();
  });

  it('renders optional icon', () => {
    render(() => <StatChip label="Tokens" value="24,608" icon={<ListIcon data-testid="icon" />} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('omits icon slot when icon is absent', () => {
    const { container } = render(() => <StatChip label="Scores" value="3" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
