import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { PendingElicitation } from '../lib/control-view';
import { ElicitationQueue } from './ElicitationQueue';

const item: PendingElicitation = {
  elicitationId: 'e1', message: 'How should Peri continue?', status: 'pending', responseAction: null,
  createdAt: null,
  fields: [
    { id: 'detail', title: 'Detail', description: null, kind: 'text', required: true, options: [] },
    { id: 'mode', title: 'Mode', description: null, kind: 'single_select', required: true, options: [{ value: 'safe', label: 'Safe', description: null }] },
    { id: 'features', title: 'Features', description: null, kind: 'multi_select', required: false, options: [{ value: 'tests', label: 'Tests', description: null }, { value: 'docs', label: 'Docs', description: null }] },
  ],
};

describe('ElicitationQueue', () => {
  it('renders ACP elicitation inline and submits typed answers', async () => {
    const respond = vi.fn();
    render(() => <ElicitationQueue elicitations={[item]} responding={{}} readOnly={false} onRespond={respond} />);
    expect(screen.getByRole('region', { name: 'Agent question' })).toBeInTheDocument();
    expect(screen.queryByText('Input needed')).not.toBeInTheDocument();
    expect(screen.getByText('Questions')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Detail');
    await fireEvent.input(screen.getByRole('textbox', { name: 'Detail' }), { target: { value: 'Keep compatibility' } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Safe' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Tests' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Docs' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(respond).toHaveBeenCalledWith('e1', 'accept', { detail: 'Keep compatibility', mode: 'safe', features: ['tests', 'docs'] });
  });

  it('maps skip and close to distinct ACP actions', async () => {
    const respond = vi.fn();
    const view = render(() => <ElicitationQueue elicitations={[item]} responding={{}} readOnly={false} onRespond={respond} />);
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(respond).toHaveBeenLastCalledWith('e1', 'decline');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel question' }));
    expect(respond).toHaveBeenLastCalledWith('e1', 'cancel');
    view.unmount();
  });

  it('collapses the question body without resolving it', async () => {
    const respond = vi.fn();
    render(() => <ElicitationQueue elicitations={[item]} responding={{}} readOnly={false} onRespond={respond} />);
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse questions' }));
    expect(screen.queryByText('How should Peri continue?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand questions' })).toHaveAttribute('aria-expanded', 'false');
    expect(respond).not.toHaveBeenCalled();
  });

  it('navigates concurrent requests without resolving them', async () => {
    const respond = vi.fn();
    const second = { ...item, elicitationId: 'e2', message: 'Second question' };
    render(() => <ElicitationQueue elicitations={[item, second]} responding={{}} readOnly={false} onRespond={respond} />);
    expect(screen.getByText('How should Peri continue?')).toBeInTheDocument();
    expect(screen.queryByText('Second question')).not.toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous question' })).toBeDisabled();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Detail' }), { target: { value: 'Keep my draft' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(screen.queryByText('How should Peri continue?')).not.toBeInTheDocument();
    expect(screen.getByText('Second question')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Previous question' }));
    expect(screen.getByText('How should Peri continue?')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Detail' })).toHaveValue('Keep my draft');
    expect(respond).not.toHaveBeenCalled();
  });

  it('locks every response path while delivery is pending', () => {
    const respond = vi.fn();
    render(() => <ElicitationQueue elicitations={[item]} responding={{ e1: 'command-1' }} readOnly={false} onRespond={respond} />);
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel question' })).toBeDisabled();
  });
});
