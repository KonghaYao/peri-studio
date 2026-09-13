import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ComposerShell } from '../src/components/composer/ComposerShell';

afterEach(() => cleanup());

describe('ComposerShell', () => {
  it('keeps compact trailing controls out of the input flex slot', () => {
    render(() => (
      <ComposerShell
        fieldPlaceholder="Message the agent"
        compactLeading={<button type="button" aria-label="Slash commands">+</button>}
        compactTrailing={<button type="button" aria-label="Model">Composer 2.5</button>}
      />
    ));

    const surface = screen.getByTestId('composer-surface');
    const textbox = screen.getByRole('textbox', { name: 'Message the agent' });
    const modelButton = screen.getByRole('button', { name: 'Model' });
    const slashButton = screen.getByRole('button', { name: 'Slash commands' });

    expect(surface).toContainElement(slashButton);
    expect(surface).toContainElement(modelButton);
    expect(textbox.parentElement).toContainElement(textbox);
    expect(textbox.parentElement).not.toContainElement(modelButton);
  });

  it('renders meta row below the surface with reserved row height', () => {
    render(() => (
      <ComposerShell
        metaRow={<span data-testid="composer-meta-content">main · This Mac</span>}
      />
    ));

    const surface = screen.getByTestId('composer-surface');
    const meta = screen.getByTestId('composer-meta-content');
    expect(surface.parentElement).toContainElement(meta);
    expect(surface.parentElement?.querySelector('[class*="min-h-28"]')).toContainElement(meta);
  });
});
