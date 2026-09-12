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
    const fieldSlot = surface.querySelector('.ui-composer-surface-v2__field-slot');
    const trailing = surface.querySelector('.ui-composer-surface-v2__trailing');
    const leading = surface.querySelector('.ui-composer-surface-v2__leading');

    expect(leading).toContainElement(screen.getByRole('button', { name: 'Slash commands' }));
    expect(trailing).toContainElement(screen.getByRole('button', { name: 'Model' }));
    expect(fieldSlot).not.toContainElement(screen.getByRole('button', { name: 'Model' }));
    expect(fieldSlot).toContainElement(screen.getByRole('textbox', { name: 'Message the agent' }));
  });
});
