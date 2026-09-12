import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceUploadBatchView } from '@/features/resource/upload-workspace-file';
import { setPromptMaxBytes } from '@/features/connection/connection';

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  enqueueComposer: vi.fn(() => true),
  enqueueQuickStart: vi.fn(() => true),
  markInjected: vi.fn(),
  origin: 'composer' as 'composer' | 'quickstart',
}));

vi.mock('@/store', async () => {
  const { createSignal } = await import('solid-js');
  const [batch, setBatch] = createSignal<WorkspaceUploadBatchView | null>(null);
  mocks.markInjected.mockImplementation((itemId: string) => {
    setBatch((current) => current ? {
      ...current,
      items: current.items.map((item) => item.id === itemId ? { ...item, referenceInjected: true } : item),
    } : null);
  });
  return {
    __uploadTest: { batch, setBatch },
    enqueueComposerRootUpload: mocks.enqueueComposer,
    enqueueQuickStartRootUpload: mocks.enqueueQuickStart,
    markWorkspaceUploadReferenceInjected: mocks.markInjected,
    retryWorkspaceUpload: mocks.retry,
    workspaceUploadAvailable: () => true,
    workspaceUploadBatch: batch,
    workspaceUploadBlockedMessage: () => 'Upload is unavailable.',
    workspaceUploadLiveMessage: () => '',
    workspaceUploadOrigin: () => mocks.origin,
    workspaceUploadProgressPercent: () => 50,
    workspaceUploadTileStatus: (item: { phase: string }) => item.phase,
  };
});

import { ComposerUploadSurface } from './ComposerUploadSurface';
import * as uploadStore from '@/store';

const { setBatch } = (uploadStore as typeof uploadStore & {
  __uploadTest: {
    setBatch: (value: WorkspaceUploadBatchView | null | ((current: WorkspaceUploadBatchView | null) => WorkspaceUploadBatchView | null)) => void;
  };
}).__uploadTest;

function item(phase: 'ready' | 'failed', overrides: Record<string, unknown> = {}) {
  return {
    id: 'upload-1',
    displayName: 'notes.txt',
    workspaceRelativePath: 'notes.txt',
    size: 4,
    phase,
    progressLoaded: phase === 'ready' ? 4 : 0,
    progressTotal: 4,
    error: phase === 'failed' ? { code: 'UNAVAILABLE', message: 'Upload failed.', retryable: true } : null,
    committedPath: phase === 'ready' ? 'notes.txt' : null,
    referenceInjected: false,
    ...overrides,
  };
}

function renderSurface(
  initialDraft = '',
  origin: 'composer' | 'quickstart' = 'composer',
  disabled = false,
) {
  const [draft, setDraft] = createSignal(initialDraft);
  const setDraftSpy = vi.fn(setDraft);
  render(() => <ComposerUploadSurface
    origin={origin}
    projectId="project-1"
    disabled={disabled}
    dropDescId="upload-status"
    getDraft={draft}
    setDraft={setDraftSpy}
    focusAt={vi.fn()}
    readCaret={() => ({ start: draft().length, end: draft().length })}
  />);
  return { draft, setDraftSpy };
}

afterEach(() => {
  setBatch(null);
  setPromptMaxBytes(0);
  mocks.retry.mockClear();
  mocks.enqueueComposer.mockClear();
  mocks.enqueueQuickStart.mockClear();
  mocks.markInjected.mockClear();
  mocks.origin = 'composer';
});

describe('ComposerUploadSurface', () => {
  it('injects a committed path once and never sends a message', async () => {
    setPromptMaxBytes(65_536);
    const { draft, setDraftSpy } = renderSurface('Review');
    setBatch({ generation: 1, projectId: 'project-1', items: [item('ready')] });

    await waitFor(() => expect(draft()).toBe('Review @notes.txt'));
    expect(mocks.markInjected).toHaveBeenCalledOnce();
    expect(setDraftSpy).toHaveBeenCalledOnce();
    const tile = screen.getByTestId('upload-asset-tile');
    expect(tile).toHaveStyle({
      width: 'var(--composer-upload-tile-width)',
      height: 'var(--composer-upload-tile-height)',
    });
    expect(tile).toHaveClass('size-(--composer-upload-tile-width)', 'shrink-0');
    expect(tile).toHaveAttribute('title', 'notes.txt');
    expect(screen.getByText('notes.txt')).toHaveClass('truncate', 'text-center');

    setBatch((current) => current ? { ...current, items: [...current.items] } : null);
    await Promise.resolve();
    expect(setDraftSpy).toHaveBeenCalledOnce();
  });

  it('prevents file dragover while disabled and announces the blocked state', () => {
    const surface = document.createElement('div');
    document.body.append(surface);
    const disabledProps = {
      origin: 'composer' as const,
      projectId: 'project-1',
      disabled: true,
      dropDescId: 'disabled-upload-status',
      surfaceRef: surface,
      getDraft: () => '',
      setDraft: vi.fn(),
      focusAt: vi.fn(),
      readCaret: () => ({ start: 0, end: 0 }),
    };
    render(() => <ComposerUploadSurface {...disabledProps} />);
    const event = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files: [new File(['data'], 'notes.txt')], items: [] },
    });

    expect(surface.dispatchEvent(event)).toBe(false);
    expect(document.getElementById('disabled-upload-status')).toHaveTextContent('Upload is unavailable while the composer is disabled.');
    surface.remove();
  });

  it('QuickStart uploads to an existing project and adds a reference without creating a session', async () => {
    setPromptMaxBytes(65_536);
    mocks.origin = 'quickstart';
    const { draft } = renderSurface('', 'quickstart');
    const input = screen.getByTestId('composer-upload-file-input');
    const file = new File(['data'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    await fireEvent.change(input);
    expect(mocks.enqueueQuickStart).toHaveBeenCalledWith('project-1', [file]);
    expect(mocks.enqueueComposer).not.toHaveBeenCalled();

    setBatch({ generation: 1, projectId: 'project-1', items: [item('ready')] });
    await waitFor(() => expect(draft()).toBe('@notes.txt'));
  });

  it('does not reference failed files and Retry does not duplicate an existing reference', async () => {
    setPromptMaxBytes(65_536);
    const { draft } = renderSurface('Review @notes.txt');
    setBatch({ generation: 1, projectId: 'project-1', items: [item('failed')] });

    await fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
    expect(draft()).toBe('Review @notes.txt');

    setBatch({ generation: 1, projectId: 'project-1', items: [item('ready')] });
    await waitFor(() => expect(mocks.markInjected).toHaveBeenCalledOnce());
    expect(draft()).toBe('Review @notes.txt');
  });
});
