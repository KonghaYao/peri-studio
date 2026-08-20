import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { setPromptDeliveryReady } from '../lib/connection';
import {
  setChatHead,
  setChatStatusSignal,
  setOpeningSession,
  setProjectSessions,
  setRuntimeDocsState,
  setSelectedCid,
  setSelectedSessionId,
} from '../store';
import { setPrincipalRole } from '../lib/auth-state';
import { setComposerDraft } from '../lib/composer-draft';
import { blockUnknownMessageDelivery, failMessageDelivery, markMessageDeliveryUncertain, messageSubmission, resetMessageDelivery, startMessageDelivery } from '../lib/message-delivery';
import { markRuntimeControlUncertain, resetRuntimeControls, startRuntimeControl } from '../lib/runtime-control';
import { Composer } from './Composer';

function resetStore() {
  setSelectedCid(null);
  setSelectedSessionId(null);
  setOpeningSession(null);
  setPrincipalRole(null);
  setChatStatusSignal({});
  setChatHead(null);
  resetRuntimeControls();
  setRuntimeDocsState({ chat: false, control: false });
  resetMessageDelivery();
  setProjectSessions([]);
  setPromptDeliveryReady(false);
}

function selectReadyChat() {
  setPrincipalRole('full');
  setPromptDeliveryReady(true);
  setSelectedSessionId('session-1');
  setSelectedCid('chat-1');
  setChatStatusSignal({ 'chat-1': 'active' });
  setChatHead({ chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null }, agent: null, activeTurn: null, pendingPermissions: [] });
  setRuntimeDocsState({ chat: true, control: true });
  setProjectSessions([{ id: 'session-1', projectId: 'project-1', acpSessionId: 'acp-1', title: 'Session A', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: 'chat-1' }]);
}

function installPrediction(id = 'prediction:1:7', text = 'check failure test') {
  setChatHead({
    chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
    agent: {
      instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
      availableCommands: [], commandCatalog: [], extensions: ['peri.prediction'], activities: [],
      inputPrediction: { id, text, createdAt: '2026-08-15T00:00:00Z' }, latestUsage: null,
      model: 'model', effort: 'high', contextWindow: 200_000, contextUsed: 42_000,
    },
    activeTurn: null, pendingPermissions: [],
  });
}

afterEach(resetStore);

describe('Composer', () => {
  it('does not imply that an unselected disabled editor can accept text', () => {
    setPrincipalRole('full');
    render(() => <Composer />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Select or create a session from the left first');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('keeps Enter, Shift+Enter, and IME composition distinct without creating a local message', () => {
    selectReadyChat();
    render(() => <Composer />);
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'inspect the state' } });

    const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(shiftEnter);
    expect(shiftEnter.defaultPrevented).toBe(false);

    const composingEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(composingEnter, 'isComposing', { value: true });
    input.dispatchEvent(composingEnter);
    expect(composingEnter.defaultPrevented).toBe(false);
    expect(messageSubmission()).toBeNull();

    const sendEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(sendEnter);
    expect(sendEnter.defaultPrevented).toBe(true);
    expect(messageSubmission()).toBeNull();
  });

  it('enables send only after meaningful input', () => {
    selectReadyChat();
    render(() => <Composer />);
    const input = screen.getByRole('textbox');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(input).toHaveAttribute('placeholder', 'Message Agent');
    expect(send).toBeDisabled();
    fireEvent.input(input, { target: { value: '  inspect the state  ' } });
    expect(send).toBeEnabled();
  });

  it('shows a negotiated Peri prediction and Tab accepts only into the draft', () => {
    selectReadyChat();
    installPrediction();
    render(() => <Composer />);
    const input = screen.getByRole('textbox', { name: 'Message the agent' });
    expect(screen.getByText('check failure test', { selector: '.composer-prediction' })).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(/Peri suggests: check failure test/);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input).toHaveValue('check failure test');
    expect(screen.queryByText('check failure test', { selector: '.composer-prediction' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(messageSubmission()).toBeNull();
  });

  it('lets pointer users accept a prediction without submitting it', () => {
    selectReadyChat();
    installPrediction();
    render(() => <Composer />);
    fireEvent.click(screen.getByRole('button', { name: /Use suggestion/ }));
    expect(screen.getByRole('textbox')).toHaveValue('check failure test');
    expect(messageSubmission()).toBeNull();
  });

  it('hides the ghost while typing and restores it when the draft is cleared', () => {
    selectReadyChat();
    installPrediction();
    render(() => <Composer />);
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'my own input' } });
    expect(screen.queryByRole('button', { name: /Use suggestion/ })).not.toBeInTheDocument();
    fireEvent.input(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /Use suggestion/ })).toBeInTheDocument();
  });

  it('Escape dismisses only the exact session prediction', async () => {
    selectReadyChat();
    installPrediction();
    render(() => <Composer />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Use suggestion/ })).not.toBeInTheDocument();

    setSelectedSessionId('session-2');
    setSelectedCid('chat-2');
    setChatStatusSignal({ 'chat-2': 'active' });
    setProjectSessions([{ id: 'session-2', projectId: 'project-1', acpSessionId: 'acp-2', title: 'Session B', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: 'chat-2' }]);
    installPrediction('prediction:1:7', 'check failure test');
    await waitFor(() => expect(screen.getByRole('button', { name: /Use suggestion/ })).toBeInTheDocument());
  });

  it('hides predictions without exact negotiation or while input is disabled', () => {
    selectReadyChat();
    installPrediction();
    setChatHead((current) => current ? {
      ...current,
      agent: current.agent ? { ...current.agent, extensions: [] } : null,
    } : null);
    const { unmount } = render(() => <Composer />);
    expect(screen.queryByRole('button', { name: /Use suggestion/ })).not.toBeInTheDocument();
    unmount();

    installPrediction();
    setRuntimeDocsState({ chat: true, control: false });
    render(() => <Composer />);
    expect(screen.queryByRole('button', { name: /Use suggestion/ })).not.toBeInTheDocument();
  });

  it('shows precise Peri usage only when token stats were negotiated', () => {
    selectReadyChat();
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: [], commandCatalog: [], extensions: ['peri.tokenStats'], activities: [], inputPrediction: null,
        latestUsage: { inputTokens: 1200, outputTokens: 345, cacheCreationTokens: null, cacheReadTokens: 900, requestId: 'req-1', model: 'model', stopReason: 'end_turn' },
        model: 'model', effort: 'high', contextWindow: 200_000, contextUsed: 42_000,
      },
      activeTurn: null, pendingPermissions: [],
    });
    render(() => <Composer />);
    const usage = screen.getByRole('img', { name: 'Input 1,200 · Output 345 · Cached 900' });
    expect(usage).toBeInTheDocument();
    expect(usage.querySelectorAll('.composer-usage__segment')).toHaveLength(3);
    expect(usage).not.toHaveTextContent('Input');
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: [], commandCatalog: [], extensions: [], activities: [], inputPrediction: null, latestUsage: null,
        model: 'model', effort: 'high', contextWindow: 200_000, contextUsed: 42_000,
      },
      activeTurn: null, pendingPermissions: [],
    });
    expect(screen.queryByRole('img', { name: /Input/ })).not.toBeInTheDocument();
  });

  it('discovers negotiated Peri Skills and inserts one without sending it', async () => {
    selectReadyChat();
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: ['compact', 'auto-issue-fixer', 'mcp__docs__search'],
        commandCatalog: [
          { name: 'compact', description: 'Compress context', kind: 'command' },
          { name: 'auto-issue-fixer', description: 'Fix an issue', kind: 'skill' },
          { name: 'mcp__docs__search', description: 'Search docs', kind: 'mcp_skill' },
        ],
        extensions: ['peri.skillNames'], activities: [], inputPrediction: null, latestUsage: null,
        model: 'model', effort: 'high', contextWindow: 200_000, contextUsed: 42_000,
      },
      activeTurn: null, pendingPermissions: [],
    });
    render(() => <Composer />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse skills (2)' }));
    expect(screen.getByRole('listbox', { name: 'Available commands and skills' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /compact/ })).not.toBeInTheDocument();
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input).toHaveValue('/auto-issue-fixer '));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('keeps the Peri Skills affordance hidden without negotiation', () => {
    selectReadyChat();
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: ['auto-issue-fixer'],
        commandCatalog: [{ name: 'auto-issue-fixer', description: 'Fix an issue', kind: 'command' }],
        extensions: [], activities: [], inputPrediction: null, latestUsage: null,
        model: 'model', effort: 'high', contextWindow: 200_000, contextUsed: 42_000,
      },
      activeTurn: null, pendingPermissions: [],
    });
    render(() => <Composer />);
    expect(screen.queryByRole('button', { name: /Skills/ })).not.toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Message the agent' });
    fireEvent.input(input, { target: { value: '/' } });
    expect(screen.getByRole('option', { name: /auto-issue-fixer.*Command/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('/');
  });

  it('does not imply readiness before both runtime documents arrive', () => {
    selectReadyChat();
    setRuntimeDocsState({ chat: true, control: false });
    render(() => <Composer />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Loading session…');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('replaces send with an actionable stop control while a turn is active', () => {
    selectReadyChat();
    setChatHead({ chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: 'turn-1', createdAt: null, updatedAt: null }, agent: null, activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null }, pendingPermissions: [] });
    render(() => <Composer />);
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeEnabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('keeps stop locked while its exact runtime control is unresolved', () => {
    selectReadyChat();
    setChatHead({ chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: 'turn-1', createdAt: null, updatedAt: null }, agent: null, activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null }, pendingPermissions: [] });
    startRuntimeControl('cancel-1', 'chat-1', 'cancel');
    render(() => <Composer />);
    expect(screen.getByRole('button', { name: 'Stopping generation' })).toBeDisabled();
  });

  it('turns an uncertain stop into an enabled same-request recovery control', () => {
    selectReadyChat();
    setChatHead({ chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: 'turn-1', createdAt: null, updatedAt: null }, agent: null, activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null }, pendingPermissions: [] });
    startRuntimeControl('cancel-uncertain', 'chat-1', 'cancel');
    markRuntimeControlUncertain('cancel-uncertain');
    render(() => <Composer />);
    const retry = screen.getByRole('button', { name: 'Confirm stop with original request' });
    expect(retry).toBeEnabled();
  });

  it('keeps an uncertain message out of the editor while exposing only same-request confirmation', async () => {
    selectReadyChat();
    setComposerDraft('session-1', 'preserved draft');
    startMessageDelivery('cmd-1', 'preserved draft', 'session-1', 'chat-1');
    markMessageDeliveryUncertain('cmd-1');
    render(() => <Composer />);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByText('Message result not confirmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm with the same request' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Back to edit' })).not.toBeInTheDocument();
  });

  it('marks an in-flight submission as busy without treating it as a conversation message', () => {
    selectReadyChat();
    startMessageDelivery('cmd-1', 'pending text', 'session-1', 'chat-1');
    render(() => <Composer />);

    expect(document.querySelector('.composer-surface')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Sending message')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription(/The message is not part of the conversation until the server projects it/);
  });

  it('restores only a definitely failed submission to the current project session draft', async () => {
    selectReadyChat();
    startMessageDelivery('cmd-1', 'restore this draft', 'session-1', 'chat-1');
    failMessageDelivery('cmd-1', 'Message submission failed');
    render(() => <Composer />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('restore this draft'));
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(messageSubmission()).toBeNull();
  });

  it('keeps delivery-unknown locked without retry or editing controls', () => {
    selectReadyChat();
    startMessageDelivery('cmd-1', 'possibly executed', 'session-1', 'chat-1');
    blockUnknownMessageDelivery('cmd-1');
    render(() => <Composer />);

    expect(screen.getByText('Message delivery result unknown')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Confirm with the same request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to edit' })).not.toBeInTheDocument();
  });

  it('isolates drafts and recovery surfaces by persisted session identity', async () => {
    selectReadyChat();
    render(() => <Composer />);
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'draft for session A' } });

    setSelectedSessionId('session-2');
    setSelectedCid('chat-2');
    expect(input).toHaveValue('');
    expect(screen.queryByText('draft for session A')).not.toBeInTheDocument();

    fireEvent.input(input, { target: { value: 'draft for session B' } });
    setSelectedSessionId('session-1');
    setSelectedCid('chat-1');
    await waitFor(() => expect(input).toHaveValue('draft for session A'));
  });

  it('never exposes another session message while explaining the global safety gate', () => {
    selectReadyChat();
    setProjectSessions([
      { id: 'session-1', projectId: 'project-1', acpSessionId: 'acp-1', title: 'Session A', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: 'chat-1' },
      { id: 'session-2', projectId: 'project-1', acpSessionId: 'acp-2', title: 'Session B', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: 'chat-2' },
    ]);
    startMessageDelivery('cmd-a', 'private draft A', 'session-1', 'chat-1');
    markMessageDeliveryUncertain('cmd-a');
    setSelectedSessionId('session-2');
    setSelectedCid('chat-2');
    render(() => <Composer />);

    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Still confirming a message in another session…');
    expect(screen.getByText('Another session is still confirming')).toBeInTheDocument();
    expect(screen.queryByText('private draft A')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to that session' })).toBeInTheDocument();
  });
});
