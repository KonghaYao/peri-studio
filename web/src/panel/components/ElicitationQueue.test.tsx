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
  ],
};

describe('ElicitationQueue', () => {
  it('validates required fields and submits one typed answer map', async () => {
    const respond = vi.fn();
    render(() => <ElicitationQueue elicitations={[item]} responding={{}} readOnly={false} onRespond={respond} />);
    await fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Detail');
    await fireEvent.input(screen.getByRole('textbox', { name: 'Detail' }), { target: { value: 'Keep compatibility' } });
    await fireEvent.click(screen.getByRole('radio', { name: 'Safe' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(respond).toHaveBeenCalledWith('e1', 'accept', { detail: 'Keep compatibility', mode: 'safe' });
  });

  it('locks every response path while delivery is pending', () => {
    render(() => <ElicitationQueue elicitations={[item]} responding={{ e1: 'command-1' }} readOnly={false} onRespond={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Submit answer/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeDisabled();
  });
});
