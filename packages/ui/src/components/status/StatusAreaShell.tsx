import { ChevronDown } from 'lucide-solid';
import { createSignal, Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Card, CardHeader } from '../Card';
import { IconButton } from '../Button';
import { Tabs, TabsList } from '../Tabs';
import {
  statusAreaShellBodyClass,
  statusAreaShellCardClass,
  statusAreaShellClass,
  statusAreaShellHeaderClass,
} from './status-area-shell-utils';

export type StatusAreaShellProps = {
  class?: string;
  tabsValue: string;
  onTabsChange: (value: string) => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  collapseExpandedLabel?: string;
  collapseCollapsedLabel?: string;
  tabBar: JSX.Element;
  children?: JSX.Element;
  'data-testid'?: string;
  'aria-label'?: string;
};

/** T3 · 状态区壳：顶栏 tab + 折叠 + 面板 slot；T4 注入 plan/async/changes 内容。 */
export const StatusAreaShell: Component<StatusAreaShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'tabsValue',
    'onTabsChange',
    'expanded',
    'onExpandedChange',
    'collapseExpandedLabel',
    'collapseCollapsedLabel',
    'tabBar',
    'children',
  ]);
  const [internalExpanded, setInternalExpanded] = createSignal(true);
  const expanded = () => local.expanded ?? internalExpanded();
  const setExpanded = (value: boolean) => {
    if (local.onExpandedChange) local.onExpandedChange(value);
    else setInternalExpanded(value);
  };
  const tabsAriaLabel = () => rest['aria-label'] ?? 'Status area';

  return (
    <section
      data-slot="status-area-shell"
      data-testid={rest['data-testid']}
      class={cn(statusAreaShellClass, local.class)}
      aria-label={rest['aria-label']}
    >
      <Card class={cn(statusAreaShellCardClass, 'rounded-14 border-border-subtle bg-surface-overlay shadow-none')}>
        <Tabs value={local.tabsValue} onChange={local.onTabsChange}>
          <CardHeader class={cn(statusAreaShellHeaderClass, 'flex-row items-center p-8')}>
            <TabsList
              class="flex min-w-0 flex-1 flex-wrap items-center gap-2 border-0"
              aria-label={tabsAriaLabel()}
            >
              {local.tabBar}
            </TabsList>
            <IconButton
              size="sm"
              label={expanded()
                ? (local.collapseExpandedLabel ?? 'Collapse status panel')
                : (local.collapseCollapsedLabel ?? 'Expand status panel')}
              showTooltip={false}
              class="shrink-0 border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary"
              aria-expanded={expanded()}
              onClick={() => setExpanded(!expanded())}
            >
              <ChevronDown
                size={14}
                strokeWidth={1.8}
                class={cn('transition-transform duration-(--duration-fast)', !expanded() && 'rotate-180')}
              />
            </IconButton>
          </CardHeader>
          <Show when={expanded()}>
            <div class={statusAreaShellBodyClass}>
              {local.children}
            </div>
          </Show>
        </Tabs>
      </Card>
    </section>
  );
};
