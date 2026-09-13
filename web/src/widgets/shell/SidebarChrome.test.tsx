import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPwaInstallPromptForTests } from '@/features/pwa/pwa-install-prompt';
import { installPwaSignals, resetPwaForTests } from '@/features/pwa/pwa-state';
import { renderWithSidebarProvider } from './sidebar-test-shell';
import { SidebarChrome } from './SidebarChrome';

afterEach(() => {
  cleanup();
  resetPwaInstallPromptForTests();
  resetPwaForTests();
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

describe('SidebarChrome settings menu', () => {
  it('keeps the gear menu outside WCO drag regions', () => {
    renderWithSidebarProvider(() => (
      <SidebarChrome onOpenSystem={() => undefined}>
        <div>sessions</div>
      </SidebarChrome>
    ));
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveClass('ui-titlebar-no-drag');
  });

  it('hides Install when the window is standalone or cannot install', async () => {
    installPwaSignals({ canInstall: false, isStandalone: true });
    const onOpenSystem = vi.fn();
    renderWithSidebarProvider(() => (
      <SidebarChrome onOpenSystem={onOpenSystem}>
        <div>sessions</div>
      </SidebarChrome>
    ));

    await openSettingsMenu();
    expect(screen.queryByRole('menuitem', { name: 'Install' })).not.toBeInTheDocument();
    selectMenuItem('System');
    expect(onOpenSystem).toHaveBeenCalledOnce();
  });

  it('shows Install when beforeinstallprompt is available', async () => {
    installPwaSignals({ canInstall: true, isStandalone: false });
    const onInstall = vi.fn();
    renderWithSidebarProvider(() => (
      <SidebarChrome onOpenSystem={() => undefined} onInstall={onInstall}>
        <div>sessions</div>
      </SidebarChrome>
    ));

    await openSettingsMenu();
    expect(screen.getByRole('menuitem', { name: 'Install' })).toBeInTheDocument();
    selectMenuItem('Install');
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it('shows Install for loopback iOS A2HS', async () => {
    installPwaSignals({
      canInstall: false,
      isStandalone: false,
      isIosLike: true,
      isSecureContext: true,
      isLoopbackHost: true,
    });
    renderWithSidebarProvider(() => (
      <SidebarChrome onOpenSystem={() => undefined}>
        <div>sessions</div>
      </SidebarChrome>
    ));
    await openSettingsMenu();
    expect(screen.getByRole('menuitem', { name: 'Install' })).toBeInTheDocument();
  });

  it('hides Install on iOS-like LAN HTTP', async () => {
    installPwaSignals({
      canInstall: false,
      isStandalone: false,
      isIosLike: true,
      isSecureContext: false,
      isLoopbackHost: false,
    });
    renderWithSidebarProvider(() => (
      <SidebarChrome onOpenSystem={() => undefined}>
        <div>sessions</div>
      </SidebarChrome>
    ));
    await openSettingsMenu();
    expect(screen.queryByRole('menuitem', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'System' })).toBeInTheDocument();
  });
});
