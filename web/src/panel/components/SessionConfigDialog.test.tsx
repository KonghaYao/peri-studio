import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';

import { setPrincipalRole } from '../lib/auth-state';
import { setConnState } from '../lib/connection';
import { setChatHead, setSessionConfigMutation } from '../store';
import { SessionModelMenu } from './SessionConfigDialog';

function projectModels() {
  setChatHead({
    chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
    agent: {
      instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
      availableCommands: [], commandCatalog: [], extensions: [], activities: [], inputPrediction: null,
      latestUsage: null, model: 'opus', effort: 'high', contextWindow: null, contextUsed: null,
      configOptions: [{
        id: 'model', name: 'Model', description: null, category: 'model', currentValue: 'opus',
        options: [
          { value: 'haiku', name: 'Haiku', description: 'Fastest' },
          { value: 'sonnet', name: 'Sonnet', description: 'Balanced' },
          { value: 'opus', name: 'Opus', description: 'Strong reasoning' },
          { value: 'fable', name: 'Fable', description: 'Flagship' },
        ],
      }],
    },
    activeTurn: null,
    pendingPermissions: [],
  });
}

afterEach(() => {
  setChatHead(null);
  setSessionConfigMutation(null);
  setPrincipalRole(null);
  setConnState({ text: 'Disconnected', kind: 'idle' });
});

describe('SessionModelMenu', () => {
  it('shows the four Agent-projected models and marks the current model', () => {
    setPrincipalRole('full');
    setConnState({ text: 'Connected', kind: 'ok' });
    projectModels();
    const trigger = document.createElement('button');
    document.body.append(trigger);

    render(() => <SessionModelMenu open id="models" trigger={() => trigger} onClose={() => {}} />);

    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
    expect(screen.getByRole('menuitem', { name: /Opus/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByLabelText('Current model')).toBeInTheDocument();
    trigger.remove();
  });

  it('closes after choosing another model', async () => {
    setPrincipalRole('full');
    setConnState({ text: 'Connected', kind: 'ok' });
    projectModels();
    const trigger = document.createElement('button');
    document.body.append(trigger);
    let closed = false;

    render(() => <SessionModelMenu open id="models" trigger={() => trigger} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Sonnet/ }));

    await waitFor(() => expect(closed).toBe(true));
    trigger.remove();
  });

  it('locks model changes while the Agent is working', () => {
    setPrincipalRole('full');
    setConnState({ text: 'Connected', kind: 'ok' });
    projectModels();
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: 'turn-1', createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: [], commandCatalog: [], extensions: [], activities: [], inputPrediction: null,
        latestUsage: null, model: 'opus', effort: 'high', contextWindow: null, contextUsed: null,
        configOptions: [{ id: 'model', name: 'Model', description: null, category: 'model', currentValue: 'opus', options: [{ value: 'haiku', name: 'Haiku', description: 'Fastest' }] }],
      },
      activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null },
      pendingPermissions: [],
    });
    const trigger = document.createElement('button');
    document.body.append(trigger);

    render(() => <SessionModelMenu open id="models" trigger={() => trigger} onClose={() => {}} />);
    expect(screen.getByRole('menuitem', { name: /Haiku/ })).toBeDisabled();
    trigger.remove();
  });
});
