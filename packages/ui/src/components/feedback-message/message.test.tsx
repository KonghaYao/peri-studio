import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageHost } from './MessageHost';
import { message } from './message-api';

afterEach(() => cleanup());

describe('message', () => {
  it('renders success message in host stack', async () => {
    render(() => <MessageHost />);
    message.success('Saved successfully');
    expect(await screen.findByRole('status')).toHaveTextContent('Saved successfully');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'success');
  });
});
