import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IoTabsShell } from './IoTabsShell';

const slots = () => ({
  renderPreview: vi.fn(() => <div data-testid="preview-slot">preview</div>),
  renderInput: vi.fn(() => <div data-testid="input-slot">input</div>),
  renderOutput: vi.fn(() => <div data-testid="output-slot">output</div>),
  renderMetadata: vi.fn(() => <div data-testid="metadata-slot">metadata</div>),
});

afterEach(() => cleanup());

describe('IoTabsShell', () => {
  it('defaults to input tab without preview', () => {
    const renderers = slots();
    render(() => <IoTabsShell {...renderers} />);

    expect(screen.queryByRole('tab', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.getByTestId('input-slot')).toBeInTheDocument();
    expect(renderers.renderInput).toHaveBeenCalled();
    expect(renderers.renderPreview).not.toHaveBeenCalled();
  });

  it('shows preview tab and content when enabled', () => {
    const renderers = slots();
    render(() => <IoTabsShell {...renderers} showPreviewTab />);

    expect(screen.getByRole('tab', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByTestId('preview-slot')).toBeInTheDocument();
    expect(renderers.renderPreview).toHaveBeenCalled();
  });

  it('switches tabs and notifies listener', async () => {
    const renderers = slots();
    const onTabChange = vi.fn();

    render(() => (
      <IoTabsShell
        {...renderers}
        defaultTab="input"
        onTabChange={onTabChange}
      />
    ));

    await fireEvent.click(screen.getByRole('tab', { name: 'Output' }));
    expect(screen.getByTestId('output-slot')).toBeInTheDocument();
    expect(onTabChange).toHaveBeenCalledWith('output');
  });

  it('honors defaultTab override when preview is hidden', () => {
    const renderers = slots();
    render(() => <IoTabsShell {...renderers} defaultTab="metadata" />);
    expect(screen.getByTestId('metadata-slot')).toBeInTheDocument();
  });
});
