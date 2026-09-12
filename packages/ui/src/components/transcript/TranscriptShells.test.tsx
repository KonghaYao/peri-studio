import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryBoundary } from './HistoryBoundary';
import {
  transcriptFooterSpacerClass,
  transcriptRowClass,
  transcriptScrollClass,
} from './transcript-layout';
import { TranscriptRowShell } from './TranscriptRowShell';
import { TranscriptViewportShell } from './TranscriptViewportShell';

afterEach(() => cleanup());

describe('TranscriptViewportShell', () => {
  it('wraps MessageScroller with transcript shell classes and aria label', () => {
    render(() => (
      <TranscriptViewportShell aria-label="Conversation messages">
        <div data-testid="transcript-body">Body</div>
      </TranscriptViewportShell>
    ));

    expect(screen.getByRole('region', { name: 'Conversation messages' })).toHaveClass(transcriptScrollClass.split(' ')[0]);
    expect(screen.getByTestId('transcript-body')).toBeInTheDocument();
  });

  it('renders optional footer spacer height', () => {
    const { container } = render(() => (
      <TranscriptViewportShell aria-label="Conversation messages" footerSpacerHeight={156}>
        <div>Body</div>
      </TranscriptViewportShell>
    ));

    const spacer = container.querySelector(`.${transcriptFooterSpacerClass}`);
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer).toHaveStyle({ height: '156px' });
  });
});

describe('TranscriptRowShell', () => {
  it('exposes listitem semantics and measures row height', () => {
    const onMeasure = vi.fn();
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 320,
      height: 48,
      top: 0,
      right: 320,
      bottom: 48,
      left: 0,
      toJSON: () => ({}),
    });
    render(() => (
      <TranscriptRowShell id="entry-1" position={2} size={5} onMeasure={onMeasure}>
        <div>Row</div>
      </TranscriptRowShell>
    ));

    const row = screen.getByRole('listitem');
    expect(row).toHaveClass(transcriptRowClass);
    expect(row).toHaveAttribute('aria-posinset', '2');
    expect(row).toHaveAttribute('aria-setsize', '5');
    expect(row).toHaveAttribute('data-transcript-id', 'entry-1');
    expect(onMeasure).toHaveBeenCalledWith('entry-1', 48);
    rect.mockRestore();
  });
});

describe('HistoryBoundary', () => {
  it('renders verified and live labels with accessible names', () => {
    render(() => <HistoryBoundary kind="verified_history" />);
    expect(screen.getByRole('separator', { name: 'Peri-verified recovered history' })).toHaveTextContent('Verified history');

    cleanup();
    render(() => <HistoryBoundary kind="live_runtime" />);
    expect(screen.getByRole('separator', { name: 'Current run' })).toHaveTextContent('Current');
  });
});
