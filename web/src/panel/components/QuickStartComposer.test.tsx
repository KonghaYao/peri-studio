import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { installPrincipalRole } from '../lib/auth-state';
import { QuickStartComposer } from './QuickStartComposer';

afterEach(() => installPrincipalRole(null));

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

  it('keeps the visible select and submission target aligned when a newer project is prepended', async () => {
    installPrincipalRole('full');
    let setProjects!: (value: Array<{ id: string; name: string }>) => void;
    function Harness() {
      const [projects, update] = createSignal([{ id: 'alpha', name: 'Alpha' }]);
      setProjects = update;
      return <QuickStartComposer projects={projects()} />;
    }
    render(() => <Harness />);

    setProjects([{ id: 'beta', name: 'Beta' }, { id: 'alpha', name: 'Alpha' }]);

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Save to project' })).toHaveValue('alpha'));
    expect(screen.getByRole('textbox', { name: 'First message' })).toHaveAttribute('placeholder', 'Ask Alpha…');
  });
});
