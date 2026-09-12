import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from './PromptInput';

afterEach(() => {
  cleanup();
});

describe('PromptInput', () => {
  it('disables submit when empty and submits trimmed text on Enter', () => {
    const onSubmit = vi.fn();

    render(() => (
      <PromptInput onSubmit={onSubmit}>
        <PromptInputTextarea aria-label="Message" />
        <PromptInputFooter>
          <PromptInputToolbar />
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>
    ));

    const textarea = screen.getByRole('textbox', { name: 'Message' });
    const submit = screen.getByRole('button', { name: 'Send message' });

    expect(submit).toBeDisabled();

    fireEvent.input(textarea, { target: { value: '  hello  ' } });
    expect(submit).not.toBeDisabled();

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith({ text: 'hello' });
    expect(textarea).toHaveValue('');
  });

  it('inserts a newline on Shift+Enter without submitting', () => {
    const onSubmit = vi.fn();

    render(() => (
      <PromptInput onSubmit={onSubmit}>
        <PromptInputTextarea aria-label="Message" />
        <PromptInputSubmit />
      </PromptInput>
    ));

    const textarea = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.input(textarea, { target: { value: 'line one' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('line one');
  });

  it('supports controlled value updates from the parent', () => {
    const onValueChange = vi.fn();

    render(() => {
      const [value] = createSignal('seed');
      return (
        <PromptInput value={value()} onValueChange={onValueChange} clearOnSubmit={false}>
          <PromptInputTextarea aria-label="Message" />
          <PromptInputSubmit />
        </PromptInput>
      );
    });

    const textarea = screen.getByRole('textbox', { name: 'Message' });
    expect(textarea).toHaveValue('seed');

    fireEvent.input(textarea, { target: { value: 'updated' } });
    expect(onValueChange).toHaveBeenCalledWith('updated');
  });

  it('exposes prompt-input slots on the composed shell', () => {
    render(() => (
      <PromptInput>
        <PromptInputTextarea aria-label="Message" />
        <PromptInputFooter>
          <PromptInputToolbar data-testid="toolbar" />
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>
    ));

    expect(document.querySelector('[data-slot="prompt-input"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="prompt-input-textarea"]')).toHaveClass('min-h-36');
    expect(screen.getByTestId('toolbar')).toHaveAttribute('data-slot', 'prompt-input-toolbar');
    expect(document.querySelector('[data-slot="prompt-input-submit"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="prompt-input-footer"]')).toBeInTheDocument();
  });
});
