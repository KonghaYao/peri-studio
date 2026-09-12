import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPromptDeliveryReady, setPromptMaxBytes } from '@/features/connection/connection';
import {
  setChatHead,
  setChatStatusSignal,
  setOpeningSession,
  setProjectSessions,
  setRuntimeDocsState,
  setSelectedCid,
  setSelectedSessionId,
} from '@/store';
import { setPrincipalRole } from '@/features/auth/auth-state';
import { composerDraft, setComposerDraft } from '@/features/composer/composer-draft';
import { acknowledgeUnknownMessageDelivery, blockUnknownMessageDelivery, failMessageDelivery, markMessageDeliveryUncertain, messageSubmission, reconcileMessageProjection, resetMessageDelivery, startMessageDelivery } from '@/features/message/message-delivery';
import { markRuntimeControlUncertain, resetRuntimeControls, startRuntimeControl } from '@/features/runtime/runtime-control';
import { Composer } from './Composer';
import { SessionModelMenu } from '@/widgets/shell/SessionConfigDialog';
import { requestComposerQuote, resetComposerQuoteRequest } from '@/features/composer/composer-quote';
import { resetWorkspaceUploadAssembly } from '@/store';

const draftOwner = (sessionId = 'session-1') => ({ principalId: 'test-full', projectId: 'project-1', sessionId });

function mountComposer(props: { layout?: 'docked' | 'centered' } = {}) {
  return render(() => (
    <Composer
      layout={props.layout}
      renderRuntimeMenu={({ id, disabled }) => <SessionModelMenu id={id} disabled={disabled} />}
    />
  ));
}

function expectEnabledComposerPlaceholder(text: string) {
  expect(screen.getByTestId('composer-placeholder-hint')).toHaveTextContent(text);
  expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '');
}

function resetStore() {
  resetComposerQuoteRequest();
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
  setPromptMaxBytes(0);
  resetWorkspaceUploadAssembly();
}

function selectReadyChat() {
  setPrincipalRole('full');
  setPromptDeliveryReady(true);
  setPromptMaxBytes(65_536);
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
  it('uses the shared compact composer geometry in the production surface', () => {
    selectReadyChat();
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: [], commandCatalog: [], extensions: [], activities: [], inputPrediction: null, latestUsage: null,
        model: 'Nova 4.1', effort: 'high', contextWindow: 200_000, contextUsed: 42_000,
        configOptions: [{
          id: 'model', name: 'Model', description: null, category: 'model', currentValue: 'nova-4.1',
          options: [{ value: 'nova-4.1', name: 'Nova 4.1', description: null }],
        }],
      },
      activeTurn: null, pendingPermissions: [],
    });
    mountComposer();

    expect(screen.getByTestId('composer-surface')).toHaveAttribute('data-slot', 'composer-surface');
    expect(screen.getByTestId('composer-surface')).toHaveClass('composer-rect-surface');
    expect(screen.getByTestId('composer-toolbar')).toHaveClass('ui-composer-toolbar');
    expect(screen.getByRole('textbox')).toHaveClass('ui-composer-input');
    expect(screen.getByTestId('composer-runtime')).toHaveTextContent('Nova 4.1');
    expect(screen.getByTestId('composer-runtime')).toHaveClass('text-content-secondary');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('ui-composer-action');
  });

  it('adds a quoted answer to the current draft without replacing existing text', async () => {
    selectReadyChat();
    setComposerDraft(draftOwner(), 'My note');
    mountComposer();

    requestComposerQuote('First line\nSecond line', 'Peri');

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('My note\n\n> Peri\n> First line\n> Second line\n\n'));
  });

  it('counts UTF-8 bytes against the negotiated prompt budget', () => {
    selectReadyChat();
    setPromptMaxBytes(5);
    mountComposer();
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: '你好' } });

    expect(screen.getByRole('alert')).toHaveTextContent('6 / 5 bytes');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('你好');
  });

  it('does not imply that an unselected disabled editor can accept text', () => {
    setPrincipalRole('full');
    mountComposer();
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Select or create a session from the left first');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('keeps Enter, Shift+Enter, and IME composition distinct without creating a local message', () => {
    selectReadyChat();
    mountComposer();
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

  it('does not commit an intermediate IME value into the controlled draft', () => {
    selectReadyChat();
    mountComposer();
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;

    input.value = '你的 pwd 在哪里';
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '里',
      inputType: 'insertCompositionText',
      isComposing: true,
    }));

    expect(composerDraft(draftOwner())).toBe('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '里',
      inputType: 'insertText',
      isComposing: false,
    }));
    expect(composerDraft(draftOwner())).toBe('你的 pwd 在哪里');
  });

  it('enables send only after meaningful input', () => {
    selectReadyChat();
    mountComposer();
    const input = screen.getByRole('textbox');
    const send = screen.getByRole('button', { name: 'Send' });
    expectEnabledComposerPlaceholder('Message the agent, or type / for commands');
    expect(send).toBeDisabled();
    fireEvent.input(input, { target: { value: '  inspect the state  ' } });
    expect(send).toBeEnabled();
  });

  it('shows a negotiated Peri prediction and Tab accepts only into the draft', () => {
    selectReadyChat();
    installPrediction();
    mountComposer();
    const input = screen.getByRole('textbox', { name: 'Message the agent' });
    expect(screen.getByTestId('composer-prediction')).toHaveTextContent('check failure test');
    expect(input).toHaveAccessibleDescription(/Peri suggests: check failure test/);
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input).toHaveValue('check failure test');
    expect(screen.queryByTestId('composer-prediction')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(messageSubmission()).toBeNull();
  });

  it('lets pointer users accept a prediction without submitting it', () => {
    selectReadyChat();
    installPrediction();
    mountComposer();
    fireEvent.click(screen.getByRole('button', { name: /Use suggestion/ }));
    expect(screen.getByRole('textbox')).toHaveValue('check failure test');
    expect(messageSubmission()).toBeNull();
  });

  it('hides the ghost while typing and restores it when the draft is cleared', () => {
    selectReadyChat();
    installPrediction();
    mountComposer();
    const input = screen.getByRole('textbox');
    fireEvent.input(input, { target: { value: 'my own input' } });
    expect(screen.queryByRole('button', { name: /Use suggestion/ })).not.toBeInTheDocument();
    fireEvent.input(input, { target: { value: '' } });
    expect(screen.getByRole('button', { name: /Use suggestion/ })).toBeInTheDocument();
  });

  it('Escape dismisses only the exact session prediction', async () => {
    selectReadyChat();
    installPrediction();
    mountComposer();
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
    const { unmount } = mountComposer();
    expect(screen.queryByRole('button', { name: /Use suggestion/ })).not.toBeInTheDocument();
    unmount();

    installPrediction();
    setRuntimeDocsState({ chat: true, control: false });
    mountComposer();
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
    mountComposer();
    const usage = screen.getByRole('button', { name: /Context usage.*Input 1,200 · Output 345 · Cached 900/ });
    expect(usage).toHaveAttribute('data-testid', 'composer-usage');
    expect(screen.queryByRole('button', { name: /Context usage/ })).toBeInTheDocument();
    setChatHead({
      chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: null, createdAt: null, updatedAt: null },
      agent: {
        instanceId: 'local', sessionId: 'acp-1', status: 'ready', lastActivityAt: null,
        availableCommands: [], commandCatalog: [], extensions: [], activities: [], inputPrediction: null, latestUsage: null,
        model: 'model', effort: 'high', contextWindow: 200_000, contextUsed: 42_000,
      },
      activeTurn: null, pendingPermissions: [],
    });
    expect(screen.queryByRole('button', { name: /Context usage/ })).not.toBeInTheDocument();
  });

  it('navigates skills with arrow keys from the composer input', async () => {
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
    mountComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Browse skills (2)' }));
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('option', { name: /mcp__docs__search.*Search docs/ })).toHaveClass('bg-sidebar-selected');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input).toHaveValue('/mcp__docs__search '));
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
    mountComposer();
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
    mountComposer();
    expect(screen.queryByRole('button', { name: /Skills/ })).not.toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Message the agent' });
    fireEvent.input(input, { target: { value: '/' } });
    expect(screen.getByRole('option', { name: /auto-issue-fixer.*Fix an issue/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('/');
  });

  it('does not imply readiness before both runtime documents arrive', () => {
    selectReadyChat();
    setRuntimeDocsState({ chat: true, control: false });
    mountComposer();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Loading session…');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('replaces send with an actionable stop control while a turn is active', () => {
    selectReadyChat();
    setChatHead({ chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: 'turn-1', createdAt: null, updatedAt: null }, agent: null, activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null }, pendingPermissions: [] });
    mountComposer();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeEnabled();
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('keeps stop locked while its exact runtime control is unresolved', () => {
    selectReadyChat();
    setChatHead({ chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: 'turn-1', createdAt: null, updatedAt: null }, agent: null, activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null }, pendingPermissions: [] });
    startRuntimeControl('cancel-1', 'chat-1', 'cancel');
    mountComposer();
    expect(screen.getByRole('button', { name: 'Stopping generation' })).toBeDisabled();
  });

  it('turns an uncertain stop into an enabled same-request recovery control', () => {
    selectReadyChat();
    setChatHead({ chat: { chatId: 'chat-1', title: 'Chat', status: 'active', activeTurnId: 'turn-1', createdAt: null, updatedAt: null }, agent: null, activeTurn: { turnId: 'turn-1', turnStatus: 'running', updatedAt: null }, pendingPermissions: [] });
    startRuntimeControl('cancel-uncertain', 'chat-1', 'cancel');
    markRuntimeControlUncertain('cancel-uncertain');
    mountComposer();
    const retry = screen.getByRole('button', { name: 'Confirm stop with original request' });
    expect(retry).toBeEnabled();
  });

  it('shows a persisted uncertain draft as locked while exposing only same-request confirmation', async () => {
    selectReadyChat();
    setComposerDraft(draftOwner(), 'preserved draft');
    startMessageDelivery('cmd-1', 'preserved draft', 'session-1', 'chat-1', draftOwner());
    markMessageDeliveryUncertain('cmd-1');
    mountComposer();
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('preserved draft'));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByText('Message result not confirmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm with the same request' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Back to edit' })).not.toBeInTheDocument();
  });

  it('marks an in-flight submission as busy without rendering redundant confirmation copy', () => {
    selectReadyChat();
    startMessageDelivery('cmd-1', 'pending text', 'session-1', 'chat-1', draftOwner());
    mountComposer();

    expect(screen.getByTestId('composer-surface')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Sending message')).not.toBeInTheDocument();
    expect(screen.queryByText('Message received by the server')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).not.toHaveAccessibleDescription();
  });

  it('restores only a definitely failed submission to the current project session draft', async () => {
    selectReadyChat();
    startMessageDelivery('cmd-1', 'restore this draft', 'session-1', 'chat-1', draftOwner());
    failMessageDelivery('cmd-1', 'Message submission failed');
    mountComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('restore this draft'));
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(messageSubmission()).toBeNull();
  });

  it('lets the user acknowledge delivery-unknown and continue without restoring the original text', () => {
    selectReadyChat();
    startMessageDelivery('cmd-1', 'possibly executed', 'session-1', 'chat-1', draftOwner());
    blockUnknownMessageDelivery('cmd-1');
    mountComposer();

    expect(screen.getByText('Message delivery result unknown')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Confirm with the same request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to edit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge and continue' }));
    expect(messageSubmission()).toBeNull();
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('allows an exactly projected unknown to clear even when the evidence archive is full', () => {
    for (let index = 0; index < 20; index += 1) {
      const commandId = `archived-${index}`;
      startMessageDelivery(commandId, `message-${index}`, `archived-session-${index}`, `archived-chat-${index}`);
      blockUnknownMessageDelivery(commandId);
      acknowledgeUnknownMessageDelivery(commandId);
    }
    selectReadyChat();
    startMessageDelivery('projected', 'already projected', 'session-1', 'chat-1', draftOwner());
    reconcileMessageProjection(new Set(['projected']));
    blockUnknownMessageDelivery('projected');
    mountComposer();

    expect(messageSubmission()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Acknowledge and continue' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('isolates drafts and recovery surfaces by persisted session identity', async () => {
    selectReadyChat();
    setProjectSessions([
      { id: 'session-1', projectId: 'project-1', acpSessionId: 'acp-1', title: 'Session A', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: 'chat-1' },
      { id: 'session-2', projectId: 'project-1', acpSessionId: 'acp-2', title: 'Session B', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: 'chat-2' },
    ]);
    mountComposer();
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

  it('keeps another session private without blocking the selected session', () => {
    selectReadyChat();
    setProjectSessions([
      { id: 'session-1', projectId: 'project-1', acpSessionId: 'acp-1', title: 'Session A', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: 'chat-1' },
      { id: 'session-2', projectId: 'project-1', acpSessionId: 'acp-2', title: 'Session B', lifecycle: 'ready', updatedAt: null, lastOpenedAt: null, activeChatId: 'chat-2' },
    ]);
    startMessageDelivery('cmd-a', 'private draft A', 'session-1', 'chat-1', draftOwner());
    markMessageDeliveryUncertain('cmd-a');
    setSelectedSessionId('session-2');
    setSelectedCid('chat-2');
    mountComposer();

    expectEnabledComposerPlaceholder('Message the agent, or type / for commands');
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.queryByText('Another session is still confirming')).not.toBeInTheDocument();
    expect(screen.queryByText('private draft A')).not.toBeInTheDocument();
  });

  it('exposes the keyboard upload entry and blocks browser default file drops', () => {
    selectReadyChat();
    mountComposer();

    expect(screen.getByRole('button', { name: 'Add attachment' })).toBeEnabled();
    expect(screen.getByTestId('composer-upload-file-input')).toBeInTheDocument();

    const surface = screen.getByTestId('composer-surface');
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const drop = new Event('drop', { bubbles: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: false }) }],
      },
    });
    Object.defineProperty(drop, 'preventDefault', { value: preventDefault });
    Object.defineProperty(drop, 'stopPropagation', { value: stopPropagation });
    surface.dispatchEvent(drop);
    expect(preventDefault).toHaveBeenCalled();
  });
});
