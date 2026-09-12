import { ChevronDown } from 'lucide-solid';
import { createSignal, Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Card, CardHeader } from '../Card';
import { IconButton } from '../Button';
import { Tabs, TabsList } from '../Tabs';

export type StatusAreaShellProps = {
  class?: string;
  title?: string;
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

/** T3 · Work status 壳：可折叠标题 + tab 条 + 面板 slot；T4 注入 plan/async/changes 内容。 */
export const StatusAreaShell: Component<StatusAreaShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'title',
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
  const title = () => local.title ?? 'Work status';

  return (
    <section
      data-slot="status-area-shell"
      data-testid={rest['data-testid']}
      class={cn('ui-status-area-shell', local.class)}
      aria-label={rest['aria-label']}
    >
      <Card class="ui-status-area-shell__card overflow-hidden rounded-14 border-border-subtle bg-surface-overlay shadow-none">
        <Tabs value={local.tabsValue} onChange={local.onTabsChange}>
          <CardHeader class="ui-status-area-shell__header gap-8 px-16 pt-14 pb-8">
            <div class="flex min-h-28 items-center gap-12">
              <span class="ui-status-area-shell__title text-12 font-medium text-content-secondary">{title()}</span>
              <IconButton
                size="sm"
                label={expanded()
                  ? (local.collapseExpandedLabel ?? 'Collapse status panel')
                  : (local.collapseCollapsedLabel ?? 'Expand status panel')}
                showTooltip={false}
                class="ml-auto border-0 bg-transparent text-content-muted hover:bg-transparent hover:text-content-primary"
                aria-expanded={expanded()}
                onClick={() => setExpanded(!expanded())}
              >
                <ChevronDown
                  size={14}
                  strokeWidth={1.8}
                  class={cn('transition-transform duration-(--duration-fast)', !expanded() && 'rotate-180')}
                />
              </IconButton>
            </div>
            <TabsList
              class="ui-status-area-shell__tabs flex min-w-0 flex-wrap items-center gap-2 border-0"
              aria-label={title()}
            >
              {local.tabBar}
            </TabsList>
          </CardHeader>
          <Show when={expanded()}>
            <div class="ui-status-area-shell__body">
              {local.children}
            </div>
          </Show>
        </Tabs>
      </Card>
    </section>
  );
};
