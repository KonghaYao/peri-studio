import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { NotificationHost } from './NotificationHost';
import { notification } from './notification-api';

afterEach(() => cleanup());

describe('notification', () => {
  it('renders success notification with title and stays visible', async () => {
    render(() => <NotificationHost placement="top-right" />);
    notification.success({
      message: 'Runtime ready',
      description: 'Instance connected and catalog synced.',
    });
    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('data-tone', 'success');
    expect(status).toHaveAttribute('data-opened');
    expect(status).toHaveTextContent('Runtime ready');
    expect(status).toHaveTextContent('Instance connected and catalog synced.');
    expect(status).toBeVisible();
  });
});
