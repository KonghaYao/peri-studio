import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageArticleShell } from './MessageArticleShell';

afterEach(() => cleanup());

describe('MessageArticleShell', () => {
  it.each([
    ['user', 'Your message', 'items-end'],
    ['assistant', 'Assistant message', undefined],
    ['system', 'System message', 'items-center'],
  ] as const)('applies role chrome for %s messages', (from, label, alignClass) => {
    render(() => (
      <MessageArticleShell from={from} aria-label={label}>
        Body
      </MessageArticleShell>
    ));

    const article = screen.getByLabelText(label);
    expect(article).toHaveClass('conversation-message', `conversation-message--${from}`, 'group/message');
    if (alignClass) {
      expect(article).toHaveClass(alignClass);
    }
  });
});
