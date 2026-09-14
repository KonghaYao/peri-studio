import { render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceUploadBatchView } from '@/features/resource/upload-workspace-file';
import { setPromptDeliveryReady, setPromptMaxBytes } from '@/features/connection/connection';
import { setPrincipalRole } from '@/features/auth/auth-state';
import {
  setChatHead,
  setChatStatusSignal,
  setProjectSessions,
  setRuntimeDocsState,
  setSelectedCid,
  setSelectedSessionId,
} from '@/store';
import { Composer } from './Composer';
import { SessionModelMenu } from '@/widgets/shell/SessionConfigDialog';

const uploadMocks = vi.hoisted(() => {
  const { createSignal } = require('solid-js') as typeof import('solid-js');
  const [batch, setBatch] = createSignal<WorkspaceUploadBatchView | null>(null);
  return { batch, setBatch };
});

vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store')>();
  return {
    ...actual,
    workspaceUploadBatch: uploadMocks.batch,
    workspaceUploadOrigin: () => 'composer',
    workspaceUploadTileStatus: (item: { phase: string }) => {
      if (item.phase === 'ready') return 'ready';
      return 'uploading';
    },
    workspaceUploadProgressPercent: () => 50,
  };
});

afterEach(() => {
  uploadMocks.setBatch(null);
  setSelectedCid(null);
  setSelectedSessionId(null);
  setPrincipalRole(null);
  setChatStatusSignal({});
  setChatHead(null);
  setRuntimeDocsState({ chat: false, control: false });
  setProjectSessions([]);
  setPromptDeliveryReady(false);
  setPromptMaxBytes(0);
});

describe('Composer attachments', () => {
  it('expands the shell and renders upload tiles from the workspace batch', () => {
    setPrincipalRole('full');
    setPromptDeliveryReady(true);
    setPromptMaxBytes(65_536);
    setSelectedSessionId('session-1');
    setSelectedCid('chat-1');
    setChatStatusSignal({ 'chat-1': 'active' });
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: null,
      activeTurn: null,
      pendingPermissions: [],
    });
    setRuntimeDocsState({ chat: true, control: true });
    setProjectSessions([{
      id: 'session-1',
      projectId: 'project-1',
      acpSessionId: 'acp-1',
      title: 'Session A',
      lifecycle: 'ready',
      updatedAt: null,
      lastOpenedAt: null,
      activeChatId: 'chat-1',
    }]);
    uploadMocks.setBatch({
      generation: 1,
      projectId: 'project-1',
      items: [{
        id: 'upload-1',
        displayName: 'clipboard-20260913-144529.png',
        workspaceRelativePath: 'clipboard-20260913-144529.png',
        size: 128,
        phase: 'uploading',
        progressLoaded: 64,
        progressTotal: 128,
        error: null,
        committedPath: null,
        referenceInjected: false,
      }],
    });

    render(() => (
      <Composer renderRuntimeMenu={({ id, disabled }) => <SessionModelMenu id={id} disabled={disabled} />} />
    ));

    expect(screen.getByTestId('composer-surface')).toHaveAttribute('data-composer-expanded', 'true');
    expect(screen.getByTestId('composer-attachment-upload-1')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-asset-tile')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByText('Wait for attachments to finish uploading before sending.')).toBeInTheDocument();
  });

  it('shows a remove button for ready uploads', () => {
    setPrincipalRole('full');
    setPromptDeliveryReady(true);
    setPromptMaxBytes(65_536);
    setSelectedSessionId('session-1');
    setSelectedCid('chat-1');
    setChatStatusSignal({ 'chat-1': 'active' });
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: null,
      activeTurn: null,
      pendingPermissions: [],
    });
    setRuntimeDocsState({ chat: true, control: true });
    setProjectSessions([{
      id: 'session-1',
      projectId: 'project-1',
      acpSessionId: 'acp-1',
      title: 'Session A',
      lifecycle: 'ready',
      updatedAt: null,
      lastOpenedAt: null,
      activeChatId: 'chat-1',
    }]);
    uploadMocks.setBatch({
      generation: 1,
      projectId: 'project-1',
      items: [{
        id: 'upload-1',
        displayName: 'clipboard-20260913-144529.png',
        workspaceRelativePath: 'clipboard-20260913-144529.png',
        size: 128,
        phase: 'ready',
        progressLoaded: 128,
        progressTotal: 128,
        error: null,
        committedPath: 'clipboard-20260913-144529.png',
        referenceInjected: true,
      }],
    });

    render(() => (
      <Composer renderRuntimeMenu={({ id, disabled }) => <SessionModelMenu id={id} disabled={disabled} />} />
    ));

    expect(screen.getByRole('button', { name: 'Remove clipboard-20260913-144529.png' })).toBeInTheDocument();
  });
});
