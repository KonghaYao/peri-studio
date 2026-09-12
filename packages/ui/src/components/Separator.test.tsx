import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Divider, Separator } from './Separator';

afterEach(() => cleanup());

describe('Separator', () => {
  it('renders horizontal separator', () => {
    const { container } = render(() => <Separator data-testid="sep" />);
    const separator = container.querySelector('[data-slot="separator"]');
    expect(separator).toBeTruthy();
    expect(separator).toHaveClass('h-px');
  });

  it('supports dashed variant', () => {
    const { container } = render(() => <Separator variant="dashed" orientation="horizontal" />);
    const separator = container.querySelector('[data-slot="separator"]');
    expect(separator).toHaveClass('border-dashed');
  });

  it('exports Divider alias', () => {
    expect(Divider).toBe(Separator);
  });
});
