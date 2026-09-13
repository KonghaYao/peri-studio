import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { installPwaSignals, resetPwaForTests } from '@/features/pwa/pwa-state';
import { ThisBrowserBlock } from './ThisBrowserBlock';

afterEach(() => {
  resetPwaForTests();
});

describe('ThisBrowserBlock', () => {
  it('hints reinstall when an installed window still has a native title bar', () => {
    installPwaSignals({
      isStandalone: true,
      wcoApiPresent: true,
      wcoOverlayVisible: false,
    });
    render(() => <ThisBrowserBlock origin="http://127.0.0.1:8456" />);

    expect(screen.getByRole('status')).toHaveTextContent('Installed');
    expect(screen.getByText('Reinstall the app to hide the window title bar')).toBeInTheDocument();
    expect(screen.queryByText(/local shortcut/)).not.toBeInTheDocument();
  });

  it('hides the reinstall hint once the overlay is visible', () => {
    installPwaSignals({
      isStandalone: true,
      wcoApiPresent: true,
      wcoOverlayVisible: true,
    });
    render(() => <ThisBrowserBlock origin="http://127.0.0.1:8456" />);

    expect(screen.getByRole('status')).toHaveTextContent('Installed');
    expect(screen.queryByText('Reinstall the app to hide the window title bar')).not.toBeInTheDocument();
  });

  it('does not hint reinstall in a browser tab', () => {
    installPwaSignals({
      isStandalone: false,
      canInstall: true,
      wcoApiPresent: true,
      wcoOverlayVisible: false,
    });
    render(() => <ThisBrowserBlock origin="http://127.0.0.1:8456" />);

    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    expect(screen.queryByText('Reinstall the app to hide the window title bar')).not.toBeInTheDocument();
    expect(screen.queryByText('Installed')).not.toBeInTheDocument();
  });
});
