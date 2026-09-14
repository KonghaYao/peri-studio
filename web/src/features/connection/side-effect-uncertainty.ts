/** 断线后禁止以原 commandId 重放的高副作用 action（session/create、prompt）。 */

export interface UncertainCommandFrame {
  commandId: string;
  type: string;
}

const SIDE_EFFECT_ACTIONS = new Set(['session/create', 'prompt']);

export function isSideEffectUncertainAction(type: string): boolean {
  return SIDE_EFFECT_ACTIONS.has(type);
}

export function quarantineDisconnectSideEffects(
  frames: readonly UncertainCommandFrame[],
  handlers: {
    forgetCommand: (commandId: string) => void;
    demotePersistentError: (commandId: string) => void;
    quarantineQuickStart: (commandId: string) => void;
    quarantineMessageDelivery: (commandId: string) => void;
  },
): void {
  for (const frame of frames) {
    if (!isSideEffectUncertainAction(frame.type)) continue;
    handlers.forgetCommand(frame.commandId);
    handlers.demotePersistentError(frame.commandId);
    if (frame.type === 'prompt') handlers.quarantineMessageDelivery(frame.commandId);
    if (frame.type === 'session/create') handlers.quarantineQuickStart(frame.commandId);
  }
}
