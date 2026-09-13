import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { resetPwaInstallPromptForTests } from '@/features/pwa/pwa-install-prompt';
import { resetPwaForTests } from '@/features/pwa/pwa-state';
import {
  DEFAULT_APPEARANCE_PREFERENCE,
  appearanceStorageKey,
} from '@/features/appearance/appearance-preference';
import { renderWithSidebarProvider } from './sidebar-test-shell';
import { AppSettingsPanel } from './AppSettingsPanel';
import { SidebarChrome } from './SidebarChrome';

afterEach(() => {
  cleanup();
  resetPwaInstallPromptForTests();
  resetPwaForTests();
  window.localStorage.removeItem(appearanceStorageKey(null));
  document.documentElement.style.removeProperty('--sidebar-frost-wash');
  document.documentElement.style.removeProperty('--sidebar-frost-fill');
  document.documentElement.style.removeProperty('--sidebar-frost-wash-blur');
  document.documentElement.style.removeProperty('--sidebar-frost-wash-hue');
});

beforeEach(() => {
  resetPwaInstallPromptForTests();
  resetPwaForTests();
});

async function openSettingsMenu() {
  const trigger = screen.getByRole('button', { name: 'Settings' });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole('menu', { name: 'Settings' })).toBeInTheDocument());
}

function selectMenuItem(name: string) {
  const item = screen.getByRole('menuitem', { name });
  fireEvent.pointerUp(item, { button: 0 });
  fireEvent.click(item);
}

describe('AppSettingsPanel', () => {
  it('opens Appearance from the gear Settings item', async () => {
    const [open, setOpen] = createSignal(false);
    renderWithSidebarProvider(() => (
      <>
        <SidebarChrome onOpenSettings={() => setOpen(true)} onOpenSystem={() => undefined}>
          <div>sessions</div>
        </SidebarChrome>
        <AppSettingsPanel open={open()} onClose={() => setOpen(false)} />
      </>
    ));

    await openSettingsMenu();
    selectMenuItem('Settings');
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Linen' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(`${DEFAULT_APPEARANCE_PREFERENCE.fillPercent}%`)).toBeInTheDocument();
  });

  it('persists a material change', async () => {
    const [open, setOpen] = createSignal(true);
    renderWithSidebarProvider(() => (
      <AppSettingsPanel open={open()} onClose={() => setOpen(false)} />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Marble' }));
    expect(screen.getByRole('button', { name: 'Marble' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(appearanceStorageKey(null))).toContain('marble');
    expect(document.documentElement.style.getPropertyValue('--sidebar-frost-wash')).toBe(
      'url("/images/sidebar-frost-marble.png")',
    );
  });
});
