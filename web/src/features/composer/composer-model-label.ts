import type { AgentInfo } from '@/entities/chat/control-view';

type ModelMutation = { configId: string; previousValue: string } | null | undefined;

/** Composer 模型徽章：优先 configOptions 里的展示名，避免内部 model id 被截断后不可读。 */
export function composerModelLabel(
  agent: AgentInfo | null | undefined,
  pendingMutation?: ModelMutation,
): string {
  if (!agent) return '—';
  const modelOption = agent.configOptions?.find((item) => item.category === 'model');
  if (modelOption) {
    const activeValue =
      pendingMutation?.configId === modelOption.id
        ? pendingMutation.previousValue
        : modelOption.currentValue;
    const choice = modelOption.options.find((item) => item.value === activeValue);
    if (choice?.name) return choice.name;
  }
  return agent.model || '—';
}
