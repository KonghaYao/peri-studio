import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import { setPrincipalRole } from '../lib/auth-state';
import { setConnState } from '../lib/connection';
import { setChatHead, setSessionConfigMutation } from '../store';
import { SessionConfigDialog } from './SessionConfigDialog';

afterEach(() => {
  setChatHead(null);
  setSessionConfigMutation(null);
  setPrincipalRole(null);
  setConnState({ text: 'Disconnected', kind: 'idle' });
});

describe('SessionConfigDialog', () => {
  it('renders only Agent-projected choices and confirms permission bypass', async () => {
    setPrincipalRole('full');
    setConnState({ text: 'Connected', kind: 'ok' });
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: [], commandCatalog: [], extensions: [], activities: [], inputPrediction: null,
        latestUsage: null, model: 'opus', effort: 'high', contextWindow: null, contextUsed: null,
        configOptions: [{
          id: 'mode', name: 'Mode', description: 'Execution mode', category: 'mode', currentValue: 'default',
          options: [
            { value: 'default', name: 'Default', description: null },
            { value: 'bypassPermissions', name: 'Bypass permissions', description: 'Skip prompts' },
          ],
        }],
      },
      activeTurn: null, pendingPermissions: [],
    });

    render(() => <SessionConfigDialog open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /Default/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Bypass permissions/ }));
    expect(screen.getByRole('alert', { name: 'Confirm permission bypass' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enable' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Bypass permissions/ })).toHaveFocus());
  });

  it('locks choices while the Agent is running', () => {
    setPrincipalRole('full');
    setConnState({ text: 'Connected', kind: 'ok' });
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: 'turn-1', createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: [], commandCatalog: [], extensions: [], activities: [], inputPrediction: null,
        latestUsage: null, model: 'opus', effort: 'high', contextWindow: null, contextUsed: null,
        configOptions: [{
          id: 'thinking_effort', name: 'Thinking effort', description: null, category: 'thought_level', currentValue: 'high',
          options: [{ value: 'high', name: 'High', description: null }],
        }],
      },
      activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null }, pendingPermissions: [],
    });

    render(() => <SessionConfigDialog open onClose={() => {}} />);
    expect(screen.getByText(/Config cannot be changed while the agent is working/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'High' })).toBeDisabled();
  });

  it('keeps the previous selection visible until the matching command is terminal', () => {
    setPrincipalRole('full');
    setConnState({ text: 'Connected', kind: 'ok' });
    setSessionConfigMutation({
      commandId: 'command-1', chatId: 'chat-1', configId: 'model', value: 'fast',
      previousValue: 'quality', phase: 'accepted',
    });
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: [], commandCatalog: [], extensions: [], activities: [], inputPrediction: null,
        latestUsage: null, model: 'fast', effort: 'high', contextWindow: null, contextUsed: null,
        configOptions: [{
          id: 'model', name: 'Model', description: null, category: 'model', currentValue: 'fast',
          options: [{ value: 'quality', name: 'Quality', description: null }, { value: 'fast', name: 'Fast', description: null }],
        }],
      },
      activeTurn: null, pendingPermissions: [],
    });

    render(() => <SessionConfigDialog open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Quality' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Fast' })).toHaveAttribute('aria-pressed', 'false');
  });
});
