import { afterEach, describe, expect, it } from 'vitest';
import {
  blockUnknownQuickStart,
  markQuickStartUncertain,
  quickStartSubmission,
  resetQuickStart,
  startQuickStart,
} from './quick-start-delivery';

afterEach(resetQuickStart);

describe('quick-start-delivery', () => {
  it('blocks reconnect retries for uncertain create deliveries', () => {
    startQuickStart('cmd-1', 'project-1', 'hello');
    markQuickStartUncertain('cmd-1');
    blockUnknownQuickStart('cmd-1');

    expect(quickStartSubmission()).toMatchObject({
      commandId: 'cmd-1',
      phase: 'delivery_unknown',
      retryable: false,
    });
  });
});
