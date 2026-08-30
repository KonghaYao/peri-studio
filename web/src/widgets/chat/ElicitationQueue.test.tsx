import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { PendingElicitation } from '@/entities/chat/control-view';
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

function rebuild(value: PendingElicitation): PendingElicitation {
  return {
    ...value,
    fields: value.fields.map((field) => ({
      ...field,
      options: field.options.map((option) => ({ ...option })),
    })),
  };
}

describe('ElicitationQueue', () => {
  it('renders ACP elicitation inline and submits typed answers', async () => {
    const respond = vi.fn();
    render(() => <ElicitationQueue elicitations={[item]} responses={{}} readOnly={false} onRefreshStatus={vi.fn()} onDismissUncertain={vi.fn()} onRespond={respond} />);
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
    const view = render(() => <ElicitationQueue elicitations={[item]} responses={{}} readOnly={false} onRefreshStatus={vi.fn()} onDismissUncertain={vi.fn()} onRespond={respond} />);
    await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(respond).toHaveBeenLastCalledWith('e1', 'decline');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel question' }));
    expect(respond).toHaveBeenLastCalledWith('e1', 'cancel');
    view.unmount();
  });

  it('collapses the question body without resolving it', async () => {
    const respond = vi.fn();
    render(() => <ElicitationQueue elicitations={[item]} responses={{}} readOnly={false} onRefreshStatus={vi.fn()} onDismissUncertain={vi.fn()} onRespond={respond} />);
    await fireEvent.click(screen.getByRole('button', { name: 'Collapse questions' }));
    expect(screen.queryByText('How should Peri continue?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand questions' })).toHaveAttribute('aria-expanded', 'false');
    expect(respond).not.toHaveBeenCalled();
  });

  it('navigates concurrent requests without resolving them', async () => {
    const respond = vi.fn();
    const second = { ...item, elicitationId: 'e2', message: 'Second question' };
    render(() => <ElicitationQueue elicitations={[item, second]} responses={{}} readOnly={false} onRefreshStatus={vi.fn()} onDismissUncertain={vi.fn()} onRespond={respond} />);
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

  it('keeps the selected question, draft, and focus when another request is inserted before it', async () => {
    const respond = vi.fn();
    const second = { ...item, elicitationId: 'e2', message: 'Second question' };
    const inserted = { ...item, elicitationId: 'e0', message: 'Inserted question' };
    const [items, setItems] = createSignal([item, second]);
    render(() => <ElicitationQueue elicitations={items()} responses={{}} readOnly={false} onRefreshStatus={vi.fn()} onDismissUncertain={vi.fn()} onRespond={respond} />);

    await fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    const input = screen.getByRole('textbox', { name: 'Detail' });
    const radio = screen.getByRole('radio', { name: 'Safe' });
    const checkbox = screen.getByRole('checkbox', { name: 'Tests' });
    await fireEvent.input(input, { target: { value: 'Draft for the second question' } });
    input.focus();
    setItems([rebuild(inserted), rebuild(item), rebuild(second)]);

    expect(screen.getByText('Second question')).toBeInTheDocument();
    expect(screen.queryByText('How should Peri continue?')).not.toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Detail' })).toBe(input);
    expect(screen.getByRole('radio', { name: 'Safe' })).toBe(radio);
    expect(screen.getByRole('checkbox', { name: 'Tests' })).toBe(checkbox);
    expect(input).toHaveValue('Draft for the second question');
    expect(input).toHaveFocus();
    expect(respond).not.toHaveBeenCalled();
  });

  it('falls back to the same queue position when the selected request disappears', async () => {
    const respond = vi.fn();
    const second = { ...item, elicitationId: 'e2', message: 'Second question' };
    const third = { ...item, elicitationId: 'e3', message: 'Third question' };
    const [items, setItems] = createSignal([item, second, third]);
    render(() => <ElicitationQueue elicitations={items()} responses={{}} readOnly={false} onRefreshStatus={vi.fn()} onDismissUncertain={vi.fn()} onRespond={respond} />);

    await fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(screen.getByText('Second question')).toBeInTheDocument();
    setItems([item, third]);

    expect(screen.getByText('Third question')).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(respond).not.toHaveBeenCalled();
  });

  it('locks every response path while delivery is pending', () => {
    const respond = vi.fn();
    render(() => <ElicitationQueue elicitations={[item]} responses={{ e1: { commandId: 'command-1', phase: 'pending', dismissed: false } }} readOnly={false} onRefreshStatus={vi.fn()} onDismissUncertain={vi.fn()} onRespond={respond} />);
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel question' })).toBeDisabled();
  });

  it('offers status refresh and local hide without allowing an unknown answer to replay', async () => {
    const respond = vi.fn();
    const refresh = vi.fn();
    const dismiss = vi.fn();
    render(() => <ElicitationQueue
      elicitations={[item]}
      responses={{ e1: { commandId: 'command-1', phase: 'delivery_unknown', dismissed: false } }}
      readOnly={false}
      onRefreshStatus={refresh}
      onDismissUncertain={dismiss}
      onRespond={respond}
    />);

    expect(screen.getByRole('alert')).toHaveTextContent('Answer delivery not confirmed');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel question' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Hide question' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(respond).not.toHaveBeenCalled();
  });
});
