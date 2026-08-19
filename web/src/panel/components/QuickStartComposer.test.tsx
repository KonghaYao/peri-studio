import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { installPrincipalRole } from '../lib/auth-state';
import { failQuickStart, markQuickStartUncertain, resetQuickStart, startQuickStart } from '../lib/quick-start-delivery';
import { QuickStartComposer } from './QuickStartComposer';

afterEach(() => {
  installPrincipalRole(null);
  resetQuickStart();
});

describe('QuickStartComposer', () => {
  it('keeps the first message while changing durable project ownership', () => {
    installPrincipalRole('full');
    render(() => <QuickStartComposer projects={[{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }]} />);

    const message = screen.getByRole('textbox', { name: 'First message' });
    const project = screen.getByRole('combobox', { name: 'Save to project' });
    fireEvent.input(message, { target: { value: 'Please review this project' } });
    fireEvent.change(project, { target: { value: 'beta' } });

    expect(message).toHaveValue('Please review this project');
    expect(project).toHaveValue('beta');
    expect(message).toHaveAttribute('placeholder', 'Ask Beta…');
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
    fireEvent.change(screen.getByRole('combobox', { name: 'Save to project' }), { target: { value: 'beta' } });
    setProjects([{ id: 'alpha', name: 'Alpha' }]);

    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Save to project' })).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'First message' })).toHaveAttribute('placeholder', 'Ask Alpha…');
  });

  it('announces creation as busy without constructing a local session or message', () => {
    installPrincipalRole('full');
    startQuickStart('create-1', 'alpha', 'first prompt');
    render(() => <QuickStartComposer projects={[{ id: 'alpha', name: 'Alpha' }]} />);

    expect(document.querySelector('.quick-start__surface')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('textbox', { name: 'First message' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Creating and connecting session…');
    expect(screen.getByRole('textbox', { name: 'First message' })).toHaveAccessibleDescription(/Waiting for the server to confirm/);
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
});
