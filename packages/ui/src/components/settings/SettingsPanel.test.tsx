import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsPanel, settingsPanelOverlayClass } from './SettingsPanel';

afterEach(() => cleanup());

describe('SettingsPanel', () => {
  it('renders split nav and detail slots', () => {
    render(() => (
      <SettingsPanel
        open
        onOpenChange={() => undefined}
        title="Settings"
        items={[
          { id: 'appearance', label: 'Appearance' },
          { id: 'general', label: 'General' },
        ]}
        selectedId="appearance"
        onSelect={() => undefined}
      >
        <p>Appearance body</p>
      </SettingsPanel>
    ));

    expect(screen.getByTestId('settings-panel')).toHaveClass('ui-settings-panel', 'ui-titlebar-no-drag');
    expect(document.querySelector('[data-dialog-overlay]')).toHaveClass(settingsPanelOverlayClass);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-appearance')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Appearance body')).toBeInTheDocument();
  });

  it('notifies when a nav item is selected', () => {
    const [selected, setSelected] = createSignal('appearance');
    render(() => (
      <SettingsPanel
        open
        onOpenChange={() => undefined}
        title="Settings"
        items={[
          { id: 'appearance', label: 'Appearance' },
          { id: 'general', label: 'General' },
        ]}
        selectedId={selected()}
        onSelect={setSelected}
      >
        <span>{selected()}</span>
      </SettingsPanel>
    ));

    fireEvent.click(screen.getByTestId('settings-nav-general'));
    expect(selected()).toBe('general');
    expect(screen.getByTestId('settings-nav-general')).toHaveAttribute('aria-current', 'page');
  });
});
