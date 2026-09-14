import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../Dialog';

export type MonitorTimelineDialogShellProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** 时间轴区域；T4 注入 `MonitorTimelineShell` 或 `MonitorTimelineBand`。 */
  timeline: JSX.Element;
  /** 选中观测详情；数据合并仍由 T4 负责。 */
  detail?: JSX.Element;
  class?: string;
  'data-testid'?: string;
};

/** T3 · Monitor 观测时间轴弹窗壳：timeline + detail 双 slot，无 store。 */
export const MonitorTimelineDialogShell: Component<MonitorTimelineDialogShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'open',
    'onOpenChange',
    'title',
    'description',
    'timeline',
    'detail',
    'class',
  ]);

  return (
    <Dialog open={local.open} onOpenChange={local.onOpenChange}>
      <DialogContent
        {...rest}
        size="default"
        class={cn(
          'ui-monitor-timeline-dialog flex max-h-(--container-dialog-tall) w-(--container-settings-panel) flex-col gap-0 overflow-hidden p-0',
          local.class,
        )}
      >
        <DialogHeader class="shrink-0 border-b border-border-subtle px-20 py-16">
          <DialogTitle class="text-15">{local.title}</DialogTitle>
          <Show when={local.description}>
            <DialogDescription class="text-12 text-content-secondary">
              {local.description}
            </DialogDescription>
          </Show>
        </DialogHeader>
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="min-h-0 shrink-0 border-b border-border-subtle px-12 py-8">
            {local.timeline}
          </div>
          <Show when={local.detail}>
            <div class="ui-scrollbar min-h-0 flex-1 overflow-auto px-20 py-16">
              {local.detail}
            </div>
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
};
