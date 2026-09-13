import { describe, expect, it } from 'vitest';
import {
  rewindDialogContentClass,
  rewindDialogPanelClass,
  rewindDialogShellClass,
  rewindPanelBodyClass,
} from '../src/components/chat/rewind-panel-layout';

describe('rewind-panel-layout', () => {
  it('keeps rewind viewport width on DialogContent, not nested children', () => {
    expect(rewindDialogContentClass).toContain('w-(--workbench-panel-width)');
    expect(rewindDialogContentClass).toContain('max-desk:w-(--container-rewind-compact)');
    expect(rewindDialogPanelClass).toBe(rewindDialogContentClass);
  });

  it('uses a flex column shell with scrollable body', () => {
    expect(rewindDialogShellClass).toContain('flex-col');
    expect(rewindDialogShellClass).toContain('overflow-hidden');
    expect(rewindPanelBodyClass).toContain('overflow-auto');
    expect(rewindPanelBodyClass).toContain('min-w-0');
  });
});
