import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreListShell } from './ScoreListShell';

afterEach(() => cleanup());

describe('ScoreListShell', () => {
  it('renders empty state', () => {
    render(() => <ScoreListShell scores={[]} />);
    expect(screen.getByText('No scores.')).toBeInTheDocument();
  });

  it('renders score rows with formatted numeric value', () => {
    render(() => (
      <ScoreListShell
        scores={[
          { id: 's1', name: 'accuracy', source: 'EVAL', value: 0.42 },
        ]}
      />
    ));

    expect(screen.getByText('accuracy')).toBeInTheDocument();
    expect(screen.getByText('EVAL')).toBeInTheDocument();
    expect(screen.getByText('0.4200')).toBeInTheDocument();
  });

  it('prefers textValue over numeric value', () => {
    render(() => (
      <ScoreListShell
        scores={[
          { id: 's2', name: 'verdict', source: 'HUMAN', value: 1, textValue: 'pass' },
        ]}
      />
    ));

    expect(screen.getByText('pass')).toBeInTheDocument();
  });

  it('supports custom empty label', () => {
    render(() => <ScoreListShell scores={[]} emptyLabel="Nothing scored yet." />);
    expect(screen.getByText('Nothing scored yet.')).toBeInTheDocument();
  });
});
