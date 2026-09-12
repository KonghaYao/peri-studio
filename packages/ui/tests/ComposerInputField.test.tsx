import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ComposerInputField } from '../src/components/composer/ComposerInputField';

afterEach(() => cleanup());

describe('ComposerInputField', () => {
  it('hides the overlay placeholder as soon as IME composition starts', () => {
    render(() => (
      <ComposerInputField
        hint={{ kind: 'placeholder', text: 'Message the agent, or type / for commands' }}
        value=""
        aria-label="Message the agent"
      />
    ));

    expect(screen.getByTestId('composer-placeholder-hint')).toHaveTextContent(
      'Message the agent, or type / for commands',
    );

    const input = screen.getByRole('textbox', { name: 'Message the agent' });
    fireEvent.compositionStart(input);
    expect(screen.queryByTestId('composer-placeholder-hint')).not.toBeInTheDocument();

    fireEvent.input(input, { target: { value: 'w' }, isComposing: true });
    expect(screen.queryByTestId('composer-placeholder-hint')).not.toBeInTheDocument();
  });

  it('restores the overlay placeholder after composition is cancelled', () => {
    render(() => (
      <ComposerInputField
        hint={{ kind: 'placeholder', text: 'Message the agent, or type / for commands' }}
        value=""
        aria-label="Message the agent"
      />
    ));

    const input = screen.getByRole('textbox', { name: 'Message the agent' }) as HTMLTextAreaElement;
    fireEvent.compositionStart(input);
    fireEvent.input(input, { target: { value: 'w' }, isComposing: true });
    input.value = '';
    fireEvent.compositionEnd(input);

    expect(screen.getByTestId('composer-placeholder-hint')).toBeInTheDocument();
  });
});
