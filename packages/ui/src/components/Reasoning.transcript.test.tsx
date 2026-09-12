import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './Reasoning';

afterEach(() => cleanup());

describe('Reasoning transcript appearance', () => {
  it('renders thinking gap skeletons while activity reasoning streams without text', () => {
    render(() => (
      <Reasoning appearance="transcript" variant="activity" isStreaming text="   ">
        <ReasoningTrigger />
        <ReasoningContent>   </ReasoningContent>
      </Reasoning>
    ));

    expect(screen.getByTestId('thinking-gap')).toHaveClass('relative', 'z-1', 'pl-32');
    expect(screen.queryByTestId('message-reasoning')).toBeNull();
  });

  it('hides completed empty activity reasoning placeholders', () => {
    render(() => (
      <Reasoning appearance="transcript" variant="activity" text="">
        <ReasoningTrigger />
        <ReasoningContent />
      </Reasoning>
    ));

    expect(screen.getByTestId('reasoning-empty-track')).toBeInTheDocument();
    expect(screen.queryByTestId('message-reasoning')).toBeNull();
  });

  it('keeps transcript reasoning collapsed by default and expands on summary click', () => {
    render(() => (
      <Reasoning appearance="transcript" variant="activity" text="Check imports first.">
        <ReasoningTrigger />
        <ReasoningContent>Check imports first.</ReasoningContent>
      </Reasoning>
    ));

    const details = screen.getByText('Reasoning').closest('details')!;
    const body = screen.getByText('Check imports first.');
    expect(screen.getByText('Reasoning')).toHaveClass('min-h-16');
    expect(details).not.toHaveAttribute('open');
    expect(body).not.toBeVisible();
    expect(body.closest('.message-reasoning__body--activity-rail')).toHaveClass('relative', 'z-1', 'pl-32');

    fireEvent.click(screen.getByText('Reasoning'));
    expect(details).toHaveAttribute('open');
    expect(body).toBeVisible();
  });
});
