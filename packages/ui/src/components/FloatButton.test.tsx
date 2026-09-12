import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { FloatButton, FloatButtonGroup } from './FloatButton';

afterEach(() => cleanup());

describe('FloatButton', () => {
  it('renders float button with data-slot', () => {
    render(() => (
      <FloatButton aria-label="Create" content="Create" />
    ));

    expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute('data-slot', 'float-button');
  });

  it('renders group trigger', () => {
    render(() => (
      <FloatButtonGroup>
        <FloatButton aria-label="Action 1" content="A" />
      </FloatButtonGroup>
    ));

    expect(document.querySelector('[data-slot="float-button-group"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open actions' })).toBeInTheDocument();
  });
});
