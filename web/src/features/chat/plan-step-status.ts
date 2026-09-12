import type { PlanStepStatus } from '@peri/ui';

/** 将 ACP plan step 状态映射为 @peri/ui PlanStep 视觉状态。 */
export function mapPlanStepStatus(status: string): PlanStepStatus {
  if (status === 'completed') return 'complete';
  if (status === 'in_progress' || status === 'running') return 'active';
  return 'pending';
}
