import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceUploadBatchView } from '@/features/resource/upload-workspace-file';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(() => true),
  retry: vi.fn(),
  refresh: vi.fn(),
  openDirectory: vi.fn(),
  openPreview: vi.fn(),
  available: true,
}));

vi.mock('../../panel/store', async () => {
  const { createSignal } = await import('solid-js');
  const [workspace, setWorkspace] = createSignal({
    projectId: 'project-1',
    repositories: [],
    loading: [],
    error: null,
    directories: {
      '': { generation: 'g1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory' }] },
    },
  });
  const [batch, setBatch] = createSignal<WorkspaceUploadBatchView | null>(null);
  return {
    __explorerUploadTest: { setBatch, setWorkspace },
    enqueueExplorerUpload: mocks.enqueue,
    openFilePreview: mocks.openPreview,
    openResourceDirectory: mocks.openDirectory,
    refreshResourceProject: mocks.refresh,
    resourceWorkspace: workspace,
    retryWorkspaceUpload: mocks.retry,
    workspaceUploadAvailable: () => mocks.available,
    workspaceUploadBatch: batch,
    workspaceUploadBlockedMessage: () => 'Connect to the server before uploading files.',
    workspaceUploadLiveMessage: () => '',
    workspaceUploadOrigin: () => 'explorer',
    workspaceUploadProgressPercent: () => 50,
  };
});

import * as panelStore from '../../panel/store';
import { ExplorerPanel } from './ExplorerPanel';

const { setBatch } = (panelStore as typeof panelStore & {
  __explorerUploadTest: {
    setBatch: (value: WorkspaceUploadBatchView | null) => void;
  };
}).__explorerUploadTest;

function transfer(file: File) {
  return {
    types: ['Files'],
    files: [file],
    items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }],
  };
}

function uploadItem(id: string, path: string, phase: 'ready' | 'failed') {
  return {
    id,
    displayName: path.split('/').at(-1)!,
    workspaceRelativePath: path,
    size: 4,
    phase,
    progressLoaded: phase === 'ready' ? 4 : 0,
    progressTotal: 4,
    error: phase === 'failed' ? { code: 'UNAVAILABLE', message: 'Upload failed. Try again.', retryable: true } : null,
    committedPath: phase === 'ready' ? path : null,
    referenceInjected: false,
  };
}

afterEach(() => {
  setBatch(null);
  mocks.enqueue.mockClear();
  mocks.retry.mockClear();
  mocks.available = true;
});

describe('Explorer upload interactions', () => {
  it('targets the workspace root and a folder without changing targets', () => {
    render(() => <ExplorerPanel />);
    const file = new File(['data'], 'notes.txt');
    fireEvent.drop(screen.getByRole('tree', { name: 'Workspace files' }), { dataTransfer: transfer(file) });
    expect(mocks.enqueue).toHaveBeenCalledWith('project-1', '', [file]);

    fireEvent.drop(screen.getByRole('treeitem', { name: /src/i }), { dataTransfer: transfer(file) });
    expect(mocks.enqueue).toHaveBeenLastCalledWith('project-1', 'src', [file]);
  });

  it('shows Explorer-only partial results and retries the failed file', async () => {
    setBatch({
      generation: 1,
      projectId: 'project-1',
      items: [uploadItem('good', 'src/good.txt', 'ready'), uploadItem('bad', 'src/bad.txt', 'failed')],
    });
    render(() => <ExplorerPanel />);

    expect(screen.getByText('src/good.txt')).toBeInTheDocument();
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
    expect(screen.getByText('src/bad.txt')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed. Try again.');
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retry).toHaveBeenCalledWith('bad');
  });

  it('prevents blocked file dragover and announces offline feedback', () => {
    mocks.available = false;
    render(() => <ExplorerPanel />);
    const event = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: transfer(new File(['data'], 'notes.txt')) });
    const prevented = !screen.getByRole('tree', { name: 'Workspace files' }).dispatchEvent(event);

    expect(prevented).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('Connect to the server before uploading files.');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
