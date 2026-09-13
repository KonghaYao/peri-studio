import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { installPrincipalRole } from '@/features/auth/auth-state';
import { failQuickStart, markQuickStartUncertain, resetQuickStart, startQuickStart } from '@/features/message/quick-start-delivery';
import { QuickStartComposer } from './QuickStartComposer';
import { setPromptMaxBytes } from '@/features/connection/connection';

afterEach(() => {
  installPrincipalRole(null);
  resetQuickStart();
  setPromptMaxBytes(0);
});

describe('QuickStartComposer', () => {
  it('uses the provided project without exposing folder or machine selectors', () => {
    installPrincipalRole('full');
    render(() => <QuickStartComposer projects={[{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }]} initialProjectId="beta" />);

    const message = screen.getByRole('textbox', { name: 'First message' });
    fireEvent.input(message, { target: { value: 'Please review this project' } });

    expect(message).toHaveValue('Please review this project');
    expect(screen.queryByRole('combobox', { name: 'Save to project' })).not.toBeInTheDocument();
    expect(screen.queryByText('Local')).not.toBeInTheDocument();
    expect(message).toHaveAttribute('placeholder', 'Message the agent, or type / for commands');
  });

  it('falls back when the selected active project disappears before submit', async () => {
    installPrincipalRole('full');
    let setProjects!: (value: Array<{ id: string; name: string }>) => void;
    function Harness() {
      const [projects, update] = createSignal([{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }]);
      setProjects = update;
      return <QuickStartComposer projects={projects()} />;
    }
    render(() => <Harness />);
    setProjects([{ id: 'alpha', name: 'Alpha' }]);

    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Save to project' })).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'First message' })).toHaveAttribute('placeholder', 'Message the agent, or type / for commands');
  });

  it('announces creation as busy without constructing a local session or message', () => {
    installPrincipalRole('full');
    startQuickStart('create-1', 'alpha', 'first prompt');
    render(() => <QuickStartComposer projects={[{ id: 'alpha', name: 'Alpha' }]} />);

    expect(screen.getByTestId('quick-start-surface')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('textbox', { name: 'First message' })).toBeDisabled();
    expect(screen.queryByText('Creating and connecting session…')).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting for the server to confirm/)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'First message' })).not.toHaveAccessibleDescription();
    expect(screen.queryByText('first prompt')).not.toBeInTheDocument();
  });

  it('keeps uncertain quick start recovery tied to the original request', () => {
    installPrincipalRole('full');
    startQuickStart('create-1', 'alpha', 'first prompt');
    markQuickStartUncertain('create-1');
    render(() => <QuickStartComposer projects={[{ id: 'alpha', name: 'Alpha' }]} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Creation result not confirmed yet');
    expect(screen.getByRole('button', { name: 'Re-confirm with the same request' })).toBeEnabled();
    expect(screen.queryByText('first prompt')).not.toBeInTheDocument();
  });

  it('returns a definite quick start failure to editable local text without creating a message', () => {
    installPrincipalRole('full');
    failQuickStart('unrelated', 'ignored');
    startQuickStart('create-1', 'alpha', 'first prompt');
    failQuickStart('create-1', 'Creation failed');
    render(() => <QuickStartComposer projects={[{ id: 'alpha', name: 'Alpha' }]} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to create session');
    expect(screen.getByRole('textbox', { name: 'First message' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Back to edit' })).toBeEnabled();
    expect(screen.queryByText('first prompt')).not.toBeInTheDocument();
  });

  it('shows the negotiated UTF-8 budget and blocks an oversized first message', () => {
    installPrincipalRole('full');
    setPromptMaxBytes(4);
    render(() => <QuickStartComposer projects={[{ id: 'alpha', name: 'Alpha' }]} />);

    fireEvent.input(screen.getByRole('textbox', { name: 'First message' }), { target: { value: '你好' } });

    expect(screen.getByRole('alert')).toHaveTextContent('6 / 4 bytes');
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Voice input' })).toBeDisabled();
  });
});
