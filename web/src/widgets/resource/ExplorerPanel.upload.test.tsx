import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceUploadBatchView } from '@/features/resource/upload-workspace-file';

const mocks = vi.hoisted(() => ({
  createEmptyFile: vi.fn(() => true),
  createDirectory: vi.fn(() => true),
  deletePath: vi.fn(() => true),
  movePath: vi.fn(() => true),
  enqueue: vi.fn(() => true),
  retry: vi.fn(),
  refresh: vi.fn(),
  openDirectory: vi.fn(),
  openPreview: vi.fn(),
  available: true,
}));

vi.mock('@/store', async () => {
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
  const [mutationState, setMutationState] = createSignal({ projectId: null as string | null, commandId: null as string | null, phase: 'idle', message: null as string | null, focusPath: undefined as string | undefined });
  const [createdFileFocus, setCreatedFileFocus] = createSignal<{ id: string; path: string } | null>(null);
  return {
    __explorerUploadTest: { setBatch, setWorkspace, setMutationState, setCreatedFileFocus },
    createEmptyExplorerFile: mocks.createEmptyFile,
    createResourceDirectory: mocks.createDirectory,
    deleteResourcePath: mocks.deletePath,
    enqueueExplorerUpload: mocks.enqueue,
    explorerCreatedFileFocus: createdFileFocus,
    fsMutationAvailability: () => ({ available: true, reason: '' }),
    fsMutationState: mutationState,
    moveResourcePath: mocks.movePath,
    openFilePreview: mocks.openPreview,
    openResourceDirectory: mocks.openDirectory,
    refreshResourceProject: mocks.refresh,
    resourceWorkspace: workspace,
    retryFsMutation: vi.fn(),
    retryWorkspaceUpload: mocks.retry,
    workspaceUploadAvailable: () => mocks.available,
    workspaceUploadBatch: batch,
    workspaceUploadBlockedMessage: () => 'Connect to the server before uploading files.',
    workspaceUploadLiveMessage: () => '',
    workspaceUploadOrigin: () => 'explorer',
    workspaceUploadProgressPercent: () => 50,
  };
});

import * as panelStore from '@/store';
import { ExplorerPanel } from './ExplorerPanel';

const { setBatch, setWorkspace, setMutationState, setCreatedFileFocus } = (panelStore as typeof panelStore & {
  __explorerUploadTest: {
    setBatch: (value: WorkspaceUploadBatchView | null) => void;
    setMutationState: (value: { projectId: string | null; commandId: string | null; phase: string; message: string | null; focusPath?: string }) => void;
    setCreatedFileFocus: (value: { id: string; path: string } | null) => void;
    setWorkspace: (value: {
      projectId: string;
      repositories: never[];
      loading: never[];
      error: null;
      directories: Record<string, { generation: string; entries: Array<Record<string, unknown>> }>;
    }) => void;
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
  setMutationState({ projectId: null, commandId: null, phase: 'idle', message: null });
  setCreatedFileFocus(null);
  mocks.enqueue.mockClear();
  mocks.createEmptyFile.mockClear();
  mocks.createDirectory.mockClear();
  mocks.deletePath.mockClear();
  mocks.movePath.mockClear();
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

  it('routes inline create and keyboard mutations through store use cases', async () => {
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory', revision: 'rev-dir' }] },
        src: { generation: 'g2', entries: [{ id: 'note', name: 'note.txt', path: 'src/note.txt', kind: 'file', revision: 'rev-file' }] },
      },
    });
    render(() => <ExplorerPanel expanded={new Set(['', 'src'])} />);

    await fireEvent.click(screen.getByRole('button', { name: 'New File' }));
    const input = screen.getByRole('textbox', { name: 'New file name' });
    await fireEvent.input(input, { target: { value: 'draft.txt' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.createEmptyFile).toHaveBeenCalledWith('project-1', 'src', 'draft.txt');

    const file = screen.getByRole('treeitem', { name: /note\.txt/i });
    file.focus();
    await fireEvent.keyDown(file, { key: 'F2' });
    const rename = screen.getByRole('textbox', { name: 'Rename item' });
    await fireEvent.input(rename, { target: { value: 'renamed.txt' } });
    await fireEvent.keyDown(rename, { key: 'Enter' });
    expect(mocks.movePath).toHaveBeenCalledWith('project-1', 'src/note.txt', 'src/renamed.txt', 'rev-file');

    const renamedFile = screen.getByRole('treeitem', { name: /note\.txt/i });
    renamedFile.focus();
    await fireEvent.keyDown(renamedFile, { key: 'Delete' });
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete permanently?');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));
    expect(mocks.deletePath).toHaveBeenCalledWith('project-1', 'src/note.txt', 'rev-file', false);
  });

  it('restores focus when refreshed mutation and new-file targets appear', async () => {
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory', revision: 'rev-dir' }] },
        src: { generation: 'g2', entries: [{ id: 'old', name: 'old.txt', path: 'src/old.txt', kind: 'file', revision: 'rev-file' }] },
      },
    });
    setMutationState({ projectId: 'project-1', commandId: 'create', phase: 'idle', message: null, focusPath: 'new-folder' });
    render(() => <ExplorerPanel expanded={new Set(['', 'src'])} />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g3', entries: [
          { id: 'src', name: 'src', path: 'src', kind: 'directory', revision: 'rev-dir' },
          { id: 'new-folder', name: 'new-folder', path: 'new-folder', kind: 'directory', revision: 'rev-new' },
        ] },
        src: { generation: 'g2', entries: [{ id: 'old', name: 'old.txt', path: 'src/old.txt', kind: 'file', revision: 'rev-file' }] },
      },
    });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-path', 'new-folder'));

    for (const [commandId, path] of [['rename', 'src/renamed.txt'], ['move', 'src/moved.txt']] as const) {
      setMutationState({ projectId: 'project-1', commandId, phase: 'idle', message: null, focusPath: path });
      setWorkspace({
        projectId: 'project-1', repositories: [], loading: [], error: null,
        directories: {
          '': { generation: 'g1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory', revision: 'rev-dir' }] },
          src: { generation: commandId, entries: [{ id: commandId, name: path.split('/').at(-1), path, kind: 'file', revision: commandId }] },
        },
      });
      await waitFor(() => expect(document.activeElement).toHaveAttribute('data-path', path));
    }

    setMutationState({ projectId: 'project-1', commandId: 'delete', phase: 'idle', message: null, focusPath: 'src' });
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g4', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory', revision: 'rev-dir' }] },
        src: { generation: 'g4', entries: [] },
      },
    });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-path', 'src'));

    setMutationState({ projectId: 'project-1', commandId: 'root-delete', phase: 'idle', message: null, focusPath: '' });
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g-root', entries: [{ id: 'other', name: 'other.txt', path: 'other.txt', kind: 'file', revision: 'rev-other' }] },
      },
    });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-path', 'other.txt'));

    setCreatedFileFocus({ id: 'upload-1', path: 'src/draft.txt' });
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g4', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory', revision: 'rev-dir' }] },
        src: { generation: 'g5', entries: [{ id: 'draft', name: 'draft.txt', path: 'src/draft.txt', kind: 'file', revision: 'rev-draft' }] },
      },
    });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-path', 'src/draft.txt'));
  });

  it('deletes an empty directory through the permanent danger confirmation', async () => {
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g1', entries: [{ id: 'empty', name: 'empty', path: 'empty', kind: 'directory', revision: 'rev-empty' }] },
        empty: { generation: 'g2', entries: [] },
      },
    });
    render(() => <ExplorerPanel />);

    const directory = screen.getByRole('treeitem', { name: /empty/i });
    directory.focus();
    await fireEvent.keyDown(directory, { key: 'Delete' });
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete permanently?');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete Permanently' }));

    expect(mocks.deletePath).toHaveBeenCalledWith('project-1', 'empty', 'rev-empty', true);
  });

  it('loads and reveals each collapsed ancestor before focusing a nested target', async () => {
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory', revision: 'rev-src' }] },
      },
    });
    setMutationState({ projectId: 'project-1', commandId: 'nested-create', phase: 'idle', message: null, focusPath: 'src/generated/result.txt' });
    render(() => <ExplorerPanel />);

    await waitFor(() => expect(mocks.openDirectory).toHaveBeenCalledWith('src'));
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory', revision: 'rev-src' }] },
        src: { generation: 'g2', entries: [{ id: 'generated', name: 'generated', path: 'src/generated', kind: 'directory', revision: 'rev-generated' }] },
      },
    });
    await waitFor(() => expect(mocks.openDirectory).toHaveBeenCalledWith('src/generated'));
    setWorkspace({
      projectId: 'project-1', repositories: [], loading: [], error: null,
      directories: {
        '': { generation: 'g1', entries: [{ id: 'src', name: 'src', path: 'src', kind: 'directory', revision: 'rev-src' }] },
        src: { generation: 'g2', entries: [{ id: 'generated', name: 'generated', path: 'src/generated', kind: 'directory', revision: 'rev-generated' }] },
        'src/generated': { generation: 'g3', entries: [{ id: 'result', name: 'result.txt', path: 'src/generated/result.txt', kind: 'file', revision: 'rev-result' }] },
      },
    });

    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-path', 'src/generated/result.txt'));
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
