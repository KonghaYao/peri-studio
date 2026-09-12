import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerPlusMenu } from '../src/components/composer/ComposerPlusMenu';
import { ComposerShell } from '../src/components/composer/ComposerShell';
import { SlashMenu } from '../src/components/composer/SlashMenu';

afterEach(() => cleanup());

const slashItems = [
  { name: 'compact', description: 'Compress context' },
  { name: 'plan', description: 'Make a plan' },
];

describe('ComposerPlusMenu', () => {
  it('opens a menu-sized slash popover from the plus button', async () => {
    const onOpenChange = vi.fn();

    render(() => (
      <ComposerShell
        fieldPlaceholder="Message the agent"
        compactLeading={(
          <ComposerPlusMenu
            open
            onOpenChange={onOpenChange}
            upload={{ onClick: () => {} }}
            slashMenu={<SlashMenu items={slashItems} activeIndex={0} />}
          />
        )}
      />
    ));

    const surface = screen.getByTestId('composer-surface');
    const popover = document.querySelector('.ui-composer-slash-popover');
    expect(surface).toBeInTheDocument();
    expect(popover).toBeInTheDocument();
    expect(popover).toHaveClass('w-(--container-slash-menu)');
    expect(screen.getByRole('button', { name: /Upload files/i })).toBeInTheDocument();
    expect(screen.getAllByRole('listbox', { name: 'Slash commands' }).length).toBeGreaterThan(0);
  });

  it('toggles from the plus trigger without clipping to the 32px button width', () => {
    const [open, setOpen] = createSignal(false);

    render(() => (
      <ComposerShell
        fieldPlaceholder="Message the agent"
        compactLeading={(
          <ComposerPlusMenu
            open={open()}
            onOpenChange={setOpen}
            slashMenu={<SlashMenu items={slashItems} />}
          />
        )}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Slash commands' }));
    expect(open()).toBe(true);
  });
});
