import {
  ArrowLeftRight,
  Bot,
  CircleDot,
  Fan,
  Layers3,
  Link,
  ListTree,
  Search,
  ShieldCheck,
  WandSparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-solid';
import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Badge } from '../Badge';
import type { MonitorObservationLevel } from './types';

type ObservationTypeStyle = {
  icon: LucideIcon;
  textClass: string;
  badgeClass: string;
};

const TYPE_STYLES: Record<string, ObservationTypeStyle> = {
  SPAN: {
    icon: ArrowLeftRight,
    textClass: 'text-accent-solid',
    badgeClass: 'border-accent-solid/30 bg-accent-soft',
  },
  EVENT: {
    icon: CircleDot,
    textClass: 'text-success',
    badgeClass: 'border-success/30 bg-success-soft',
  },
  GENERATION: {
    icon: Fan,
    textClass: 'text-danger',
    badgeClass: 'border-danger/30 bg-danger-soft',
  },
  AGENT: {
    icon: Bot,
    textClass: 'text-accent-solid',
    badgeClass: 'border-accent-solid/30 bg-accent-soft',
  },
  TOOL: {
    icon: Wrench,
    textClass: 'text-warning',
    badgeClass: 'border-warning/30 bg-warning-soft',
  },
  CHAIN: {
    icon: Link,
    textClass: 'text-danger',
    badgeClass: 'border-danger/30 bg-danger-soft',
  },
  RETRIEVER: {
    icon: Search,
    textClass: 'text-success',
    badgeClass: 'border-success/30 bg-success-soft',
  },
  EVALUATOR: {
    icon: WandSparkles,
    textClass: 'text-accent-solid',
    badgeClass: 'border-accent-solid/30 bg-accent-soft',
  },
  EMBEDDING: {
    icon: Layers3,
    textClass: 'text-warning',
    badgeClass: 'border-warning/30 bg-warning-soft',
  },
  GUARDRAIL: {
    icon: ShieldCheck,
    textClass: 'text-danger',
    badgeClass: 'border-danger/30 bg-danger-soft',
  },
};

const FALLBACK_STYLE: ObservationTypeStyle = {
  icon: ListTree,
  textClass: 'text-content-muted',
  badgeClass: 'border-border-subtle bg-surface-sunken',
};

export function monitorObservationTypeStyle(type: string): ObservationTypeStyle {
  return TYPE_STYLES[type.trim().toUpperCase()] ?? FALLBACK_STYLE;
}

function renderObservationTypeIcon(
  type: string,
  props: { size?: number; class?: string },
): JSX.Element {
  const style = monitorObservationTypeStyle(type);
  const iconProps = {
    size: props.size ?? 14,
    class: props.class,
    'aria-hidden': true as const,
  };
  const Icon = style.icon;
  return <Icon {...iconProps} />;
}

export type MonitorObservationTypeBadgeProps = {
  type: string;
  class?: string;
  'data-testid'?: string;
};

/** T3 · Langfuse observation type 徽章（图标 + 类型名）。 */
export const MonitorObservationTypeBadge: Component<MonitorObservationTypeBadgeProps> = (props) => {
  const [local, rest] = splitProps(props, ['type', 'class']);
  const style = () => monitorObservationTypeStyle(local.type);

  return (
    <Badge
      {...rest}
      class={cn(
        'gap-4 px-6 py-2 font-500',
        style().badgeClass,
        style().textClass,
        local.class,
      )}
    >
      {renderObservationTypeIcon(local.type, { size: 12 })}
      {local.type}
    </Badge>
  );
};

export type MonitorObservationTypeIconProps = {
  type: string;
  class?: string;
};

/** T3 · observation type 彩色图标（树行 / timeline 块内复用）。 */
export const MonitorObservationTypeIcon: Component<MonitorObservationTypeIconProps> = (props) => {
  const [local, rest] = splitProps(props, ['type', 'class']);
  const style = () => monitorObservationTypeStyle(local.type);

  return renderObservationTypeIcon(local.type, {
    size: 14,
    class: cn('shrink-0', style().textClass, local.class),
    ...rest,
  });
};

const LEVEL_TONE: Record<MonitorObservationLevel, 'neutral' | 'danger' | 'warning' | 'info'> = {
  DEFAULT: 'neutral',
  ERROR: 'danger',
  WARNING: 'warning',
  DEBUG: 'info',
};

export type MonitorObservationLevelBadgeProps = {
  level: MonitorObservationLevel | string | null | undefined;
  class?: string;
  'data-testid'?: string;
};

/** T3 · observation level 徽章。 */
export const MonitorObservationLevelBadge: Component<MonitorObservationLevelBadgeProps> = (props) => {
  const [local, rest] = splitProps(props, ['level', 'class']);
  const normalized = () => (local.level ?? 'DEFAULT').toString().toUpperCase() as MonitorObservationLevel;

  return (
    <Show
      when={normalized() !== 'DEFAULT'}
      fallback={<span class="text-content-muted">—</span>}
    >
      <Badge {...rest} tone={LEVEL_TONE[normalized()] ?? 'neutral'} class={local.class}>
        {normalized()}
      </Badge>
    </Show>
  );
};
