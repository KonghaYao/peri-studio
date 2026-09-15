import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonitorTraceTurnTreeSheetShell } from './MonitorTraceTurnTreeSheetShell';

afterEach(() => cleanup());

describe('MonitorTraceTurnTreeSheetShell', () => {
  it('renders tree body and opens detail sheet when open', async () => {
    render(() => (
      <MonitorTraceTurnTreeSheetShell
        open
        onOpenChange={() => {}}
        tree={<div data-testid="tree-body">Tree</div>}
        detail={<div data-testid="detail-body">Detail</div>}
        detailTitle="step-1"
      />
    ));

    expect(screen.getByTestId('monitor-trace-turn-tree-sheet-shell')).toBeInTheDocument();
    expect(screen.getByTestId('tree-body')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('detail-body')).toBeInTheDocument();
      expect(screen.getByText('step-1')).toBeInTheDocument();
    });
  });

  it('closes sheet via onOpenChange when close is clicked', async () => {
    const onOpenChange = vi.fn();
    render(() => (
      <MonitorTraceTurnTreeSheetShell
        open
        onOpenChange={onOpenChange}
        tree={<div>Tree</div>}
        detail={<div>Detail</div>}
      />
    ));

    const close = await waitFor(() => screen.getByLabelText('Close observation detail'));
    await fireEvent.click(close);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
