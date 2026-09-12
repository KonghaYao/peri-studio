import { createMemo, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../lib/cn';

export type ProgressStatus = 'success' | 'exception' | 'active' | 'normal';
export type ProgressCircleType = 'circle' | 'dashboard';

export type ProgressCircleProps = {
  percent?: number;
  size?: number;
  strokeWidth?: number;
  type?: ProgressCircleType;
  status?: ProgressStatus;
  format?: (percent: number) => JSX.Element | string;
  steps?: number;
  class?: string;
};

const statusStroke: Record<ProgressStatus, string> = {
  success: 'text-success',
  exception: 'text-danger',
  active: 'text-accent',
  normal: 'text-accent',
};

/** 环形/仪表盘进度，对齐 Ant Design Progress circle/dashboard。 */
export const ProgressCircle: Component<ProgressCircleProps> = (props) => {
  const [local] = splitProps(props, [
    'percent',
    'size',
    'strokeWidth',
    'type',
    'status',
    'format',
    'steps',
    'class',
  ]);
  const percent = () => Math.min(100, Math.max(0, local.percent ?? 0));
  const size = () => local.size ?? 96;
  const stroke = () => local.strokeWidth ?? 6;
  const radius = createMemo(() => (size() - stroke()) / 2);
  const circumference = createMemo(() => 2 * Math.PI * radius());
  const dashOffset = createMemo(() => circumference() * (1 - percent() / 100));
  const gapDegree = () => (local.type === 'dashboard' ? 75 : 0);
  const rotate = () => (local.type === 'dashboard' ? 135 + gapDegree() / 2 : -90);
  const strokeClass = () => statusStroke[local.status ?? (percent() >= 100 ? 'success' : 'active')];
  const label = () => local.format?.(percent()) ?? `${percent()}%`;

  return (
    <div
      data-slot="progress-circle"
      data-type={local.type ?? 'circle'}
      class={cn('relative inline-flex items-center justify-center', local.class)}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent()}
    >
      <svg width={size()} height={size()} class="-rotate-90">
        <circle
          cx={size() / 2}
          cy={size() / 2}
          r={radius()}
          fill="none"
          stroke="var(--surface-sunken)"
          stroke-width={stroke()}
          stroke-dasharray={local.steps ? `${circumference() / local.steps} ${circumference()}` : undefined}
        />
        <circle
          cx={size() / 2}
          cy={size() / 2}
          r={radius()}
          fill="none"
          class={strokeClass()}
          stroke="currentColor"
          stroke-width={stroke()}
          stroke-linecap="round"
          stroke-dasharray={`${circumference()} ${circumference()}`}
          stroke-dashoffset={dashOffset()}
          transform={`rotate(${rotate()} ${size() / 2} ${size() / 2})`}
        />
      </svg>
      <div class="absolute inset-0 flex items-center justify-center text-14 font-medium text-text-primary">
        {label()}
      </div>
    </div>
  );
};
