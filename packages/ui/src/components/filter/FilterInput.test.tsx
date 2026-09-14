import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterInput, type FilterInputHandle } from './FilterInput';

afterEach(() => cleanup());

describe('FilterInput', () => {
  it('commits trimmed value on Enter', () => {
    const onCommit = vi.fn();
    render(() => <FilterInput value={undefined} onCommit={onCommit} placeholder="Search" />);

    const input = screen.getByPlaceholderText('Search');
    fireEvent.input(input, { target: { value: '  trace-id  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith('trace-id');
  });

  it('commits undefined when Enter on empty draft', () => {
    const onCommit = vi.fn();
    render(() => <FilterInput value="existing" onCommit={onCommit} placeholder="Search" />);

    const input = screen.getByPlaceholderText('Search');
    fireEvent.input(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith(undefined);
  });

  it('reverts draft on Escape without committing', () => {
    const onCommit = vi.fn();
    render(() => <FilterInput value="committed" onCommit={onCommit} placeholder="Search" />);

    const input = screen.getByPlaceholderText('Search') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'draft' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('committed');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('clears draft and commits undefined', () => {
    const onCommit = vi.fn();
    render(() => <FilterInput value="trace" onCommit={onCommit} placeholder="Search" />);

    fireEvent.click(screen.getByLabelText('Clear Search'));
    expect(onCommit).toHaveBeenCalledWith(undefined);
  });

  it('syncs draft when external value changes', () => {
    function Harness() {
      const [value, setValue] = createSignal<string | undefined>('alpha');
      return (
        <>
          <FilterInput value={value()} onCommit={setValue} placeholder="Search" />
          <button type="button" onClick={() => setValue('beta')}>external</button>
        </>
      );
    }

    render(() => <Harness />);
    const input = screen.getByPlaceholderText('Search') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'draft' } });
    expect(input.value).toBe('draft');

    fireEvent.click(screen.getByText('external'));
    expect(input.value).toBe('beta');
  });

  it('exposes commit() via ref handle', () => {
    const onCommit = vi.fn();
    let handle: FilterInputHandle | undefined;

    render(() => (
      <FilterInput
        value={undefined}
        onCommit={onCommit}
        placeholder="Search"
        ref={(next) => {
          handle = next;
        }}
      />
    ));

    fireEvent.input(screen.getByPlaceholderText('Search'), { target: { value: 'via-ref' } });
    handle?.commit();
    expect(onCommit).toHaveBeenCalledWith('via-ref');
  });
});
