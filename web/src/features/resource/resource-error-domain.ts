export type ResourceErrorDomain = 'explorer' | 'graph';

/** 将 resource 请求 key 映射到工作台错误展示域。 */
export function resourceErrorDomain(key: string | undefined): ResourceErrorDomain {
  if (key?.startsWith('log:')) return 'graph';
  return 'explorer';
}

export function resourceWorkspaceErrorForView(
  state: { explorerError: string | null; graphError: string | null },
  view: 'explorer' | 'scm' | 'graph',
): string | null {
  if (view === 'graph') return state.graphError;
  return state.explorerError;
}
