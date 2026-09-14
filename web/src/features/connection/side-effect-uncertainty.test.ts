import { describe, expect, it, vi } from 'vitest';
import { quarantineDisconnectSideEffects } from './side-effect-uncertainty';

describe('quarantineDisconnectSideEffects', () => {
  it('quarantines create and prompt uncertainties after disconnect', () => {
    const forgetCommand = vi.fn();
    const demotePersistentError = vi.fn();
    const quarantineQuickStart = vi.fn();
    const quarantineMessageDelivery = vi.fn();

    quarantineDisconnectSideEffects([
      { commandId: 'create-1', type: 'session/create' },
      { commandId: 'prompt-1', type: 'prompt' },
      { commandId: 'open-1', type: 'session/open' },
    ], {
      forgetCommand,
      demotePersistentError,
      quarantineQuickStart,
      quarantineMessageDelivery,
    });

    expect(forgetCommand).toHaveBeenCalledTimes(2);
    expect(demotePersistentError).toHaveBeenCalledTimes(2);
    expect(quarantineQuickStart).toHaveBeenCalledWith('create-1');
    expect(quarantineMessageDelivery).toHaveBeenCalledWith('prompt-1');
    expect(forgetCommand).not.toHaveBeenCalledWith('open-1');
  });
});
