import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Steps } from './Steps';

afterEach(() => cleanup());

describe('Steps', () => {
  it('renders step items with status', () => {
    render(() => (
      <Steps
        current={1}
        items={[
          { title: 'Start', description: 'Done' },
          { title: 'Process', description: 'In progress' },
          { title: 'End' },
        ]}
      />
    ));

    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Process')).toBeInTheDocument();
    const items = document.querySelectorAll('[data-slot="steps-item"]');
    expect(items.length).toBe(3);
    expect(items[1]).toHaveAttribute('data-status', 'process');
  });

  it('calls onChange when step is clicked', () => {
    const onChange = vi.fn();
    render(() => (
      <Steps
        current={0}
        onChange={onChange}
        items={[{ title: 'One' }, { title: 'Two' }]}
      />
    ));

    fireEvent.click(screen.getByText('Two'));
    expect(onChange).toHaveBeenCalledWith(1);
  });
});
