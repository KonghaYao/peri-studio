import { ChevronDown, ChevronUp } from 'lucide-solid';
import { createSignal, Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';

export type TerminalDockShellProps = {
  class?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  'aria-label'?: string;
  'data-testid'?: string;
  collapseExpandedLabel?: string;
  collapseCollapsedLabel?: string;
  headerActions?: JSX.Element;
  title?: JSX.Element;
  status?: JSX.Element;
  viewport?: JSX.Element;
  footer?: JSX.Element;
};

/** T3 · Terminal dock 壳：可折叠 header + viewport + footer；折叠仅隐藏 viewport，不卸载子树。 */
export const TerminalDockShell: Component<TerminalDockShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'expanded',
    'onExpandedChange',
    'collapseExpandedLabel',
    'collapseCollapsedLabel',
    'headerActions',
    'title',
    'status',
    'viewport',
    'footer',
  ]);
  const [internalExpanded, setInternalExpanded] = createSignal(true);
  const expanded = () => local.expanded ?? internalExpanded();
  const setExpanded = (value: boolean) => {
    if (local.onExpandedChange) local.onExpandedChange(value);
    else setInternalExpanded(value);
  };
  const collapsible = () => local.onExpandedChange !== undefined;

  return (
    <section
      data-slot="terminal-dock-shell"
      data-testid={rest['data-testid']}
      data-expanded={expanded() ? 'true' : 'false'}
      class={cn('ui-terminal-dock-shell', local.class)}
      aria-label={rest['aria-label']}
    >
      <header class="ui-terminal-dock-shell__header">
        <Show when={collapsible()}>
          <IconButton
            size="sm"
            label={expanded()
              ? (local.collapseExpandedLabel ?? 'Collapse terminal viewport')
              : (local.collapseCollapsedLabel ?? 'Expand terminal viewport')}
            showTooltip={false}
            aria-expanded={expanded()}
            onClick={() => setExpanded(!expanded())}
          >
            {expanded() ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </IconButton>
        </Show>
        <Show when={local.title}>
          <div class="ui-terminal-dock-shell__title">{local.title}</div>
        </Show>
        <span class="ui-terminal-dock-shell__spacer" aria-hidden="true" />
        <Show when={local.headerActions}>
          <div class="ui-terminal-dock-shell__header-actions">{local.headerActions}</div>
        </Show>
      </header>

      <div
        class={cn(
          'ui-terminal-dock-shell__viewport',
          !expanded() && 'ui-terminal-dock-shell__viewport--collapsed',
        )}
        aria-hidden={!expanded()}
      >
        {local.viewport}
      </div>

      <footer class="ui-terminal-dock-shell__footer">
        <Show when={local.status}>
          <div class="ui-terminal-dock-shell__status">{local.status}</div>
        </Show>
        {local.footer}
      </footer>
    </section>
  );
};
