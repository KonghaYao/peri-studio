import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  PromptInputToolbar,
} from './PromptInput';

afterEach(() => {
  cleanup();
});

describe('PromptInput', () => {
  it('disables submit when empty and submits trimmed text on Enter', async () => {
    const onSubmit = vi.fn();

    render(() => (
      <PromptInput onSubmit={onSubmit}>
        <PromptInputTextarea aria-label="Message" />
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit />
        </PromptInputFooter>
      </PromptInput>
    ));

    const textarea = screen.getByRole('textbox', { name: 'Message' });
    const submit = screen.getByRole('button', { name: 'Submit' });

    expect(submit).toBeDisabled();

    fireEvent.input(textarea, { target: { value: '  hello  ' } });
    expect(submit).not.toBeDisabled();

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ text: 'hello', files: [] });
    });
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
    expect(screen.getByTestId('toolbar')).toHaveAttribute('data-slot', 'prompt-input-tools');
    expect(document.querySelector('[data-slot="prompt-input-submit"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="prompt-input-footer"]')).toBeInTheDocument();
  });

  it('includes files in submit payload and supports ChatStatus stop', () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();

    render(() => (
      <PromptInput onSubmit={onSubmit}>
        <PromptInputTextarea aria-label="Message" />
        <PromptInputSubmit status="streaming" onStop={onStop} />
      </PromptInput>
    ));

    const stopButton = screen.getByRole('button', { name: 'Stop' });
    expect(stopButton).not.toBeDisabled();
    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('rejects files that do not match accept', () => {
    const onError = vi.fn();
    const onSubmit = vi.fn();

    render(() => (
      <PromptInput accept="image/*" onError={onError} onSubmit={onSubmit}>
        <PromptInputTextarea aria-label="Message" />
        <PromptInputSubmit />
      </PromptInput>
    ));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(onError).toHaveBeenCalledWith({
      code: 'accept',
      message: 'No files match the accepted types.',
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
