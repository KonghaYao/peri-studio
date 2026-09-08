import { isTurnActive, type ActiveTurnLike } from '@/features/runtime/action-state';

/** Session Doc `loading` 仅在活动 turn 未终态时驱动 UI loading（与 §7.2 turn 生命周期对齐）。 */
export function chatAgentLoading(
  loading: boolean | undefined,
  activeTurn: ActiveTurnLike | null | undefined,
): boolean {
  return loading === true && isTurnActive(activeTurn);
}
