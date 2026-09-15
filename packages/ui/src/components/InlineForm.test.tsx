import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { InlineForm } from './InlineForm';

afterEach(() => cleanup());

describe('InlineForm', () => {
  it('renders as a form with grid layout slots', () => {
    render(() => (
      <InlineForm data-testid="toolbar" minTrack={120} gap={8}>
        <InlineForm.Field data-testid="name-field">
          <input aria-label="Name" />
        </InlineForm.Field>
        <InlineForm.Field>
          <select aria-label="Type">
            <option>All</option>
          </select>
        </InlineForm.Field>
        <InlineForm.Actions>
          <Button type="submit">Search</Button>
        </InlineForm.Actions>
      </InlineForm>
    ));

    const form = screen.getByTestId('toolbar');
    expect(form.tagName).toBe('FORM');
    expect(form).toHaveAttribute('data-slot', 'inline-form');
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByTestId('name-field')).toHaveAttribute('data-slot', 'inline-form-field');
    expect(screen.getByRole('button', { name: 'Search' }).parentElement).toHaveAttribute(
      'data-slot',
      'inline-form-actions',
    );
  });

  it('applies column span on fields', () => {
    render(() => (
      <InlineForm columns={4}>
        <InlineForm.Field data-testid="wide" span={2}>
          <input aria-label="Wide" />
        </InlineForm.Field>
      </InlineForm>
    ));

    expect(screen.getByTestId('wide')).toHaveStyle({ 'grid-column': 'span 2' });
  });

  it('calls onSubmit on Enter and submit button', () => {
    const onSubmit = vi.fn();
    render(() => (
      <InlineForm onSubmit={onSubmit}>
        <InlineForm.Field>
          <input aria-label="Query" />
        </InlineForm.Field>
        <InlineForm.Actions>
          <Button type="submit">Search</Button>
        </InlineForm.Actions>
      </InlineForm>
    ));

    fireEvent.submit(screen.getByRole('form'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('spans trailing actions across the grid row', () => {
    render(() => (
      <InlineForm>
        <InlineForm.Actions trailing data-testid="actions">
          <Button type="button">Refresh</Button>
        </InlineForm.Actions>
      </InlineForm>
    ));

    expect(screen.getByTestId('actions')).toHaveStyle({ 'grid-column': '1 / -1' });
  });
});
