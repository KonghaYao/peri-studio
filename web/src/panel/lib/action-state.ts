/** 判定一个 ACP 会话是否仍处于活动 turn（store 的 turnActive 与 runtime 对账使用）。 */
export interface ActiveTurnLike {
  turnStatus?: unknown;
}

export const isTurnActive = (activeTurn: ActiveTurnLike | null | undefined): boolean => {
  if (!activeTurn) return false;
  const status = String(activeTurn.turnStatus || '').toLowerCase();
  return !['completed', 'complete', 'interrupted', 'cancelled', 'canceled', 'failed', 'error', 'ended'].includes(status);
};

/** 终态对话（ACP 进程已退出/用户关闭/崩溃）：只读历史，禁交互。 */
export function isTerminal(status: string | undefined): boolean {
  return status === 'ended' || status === 'closed' || status === 'crashed';
}
