import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsAppearancePane } from './SettingsAppearancePane';

afterEach(() => cleanup());

const MATERIALS = [
  { id: 'clouds', label: 'Clouds', previewSrc: '/images/sidebar-frost-wash.png' },
  { id: 'marble', label: 'Marble', previewSrc: '/images/sidebar-frost-marble.png' },
];

describe('SettingsAppearancePane', () => {
  it('renders material swatches and opacity control', () => {
    const onSelect = vi.fn();
    const onFillChange = vi.fn();
    const onWashBlurChange = vi.fn();
    const onWashHueChange = vi.fn();
    render(() => (
      <SettingsAppearancePane
        materials={MATERIALS}
        selectedId="clouds"
        onSelect={onSelect}
        fillPercent={50}
        onFillChange={onFillChange}
        washBlurPx={12}
        onWashBlurChange={onWashBlurChange}
        washHueDeg={0}
        onWashHueChange={onWashHueChange}
      />
    ));

    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clouds' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Marble' }));
    expect(onSelect).toHaveBeenCalledWith('marble');
    expect(screen.getByLabelText('Opacity')).toBeInTheDocument();
    expect(screen.getByLabelText('Blur')).toBeInTheDocument();
    expect(screen.getByLabelText('Hue')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('12px')).toBeInTheDocument();
    expect(screen.getByText('0°')).toBeInTheDocument();
  });
});
