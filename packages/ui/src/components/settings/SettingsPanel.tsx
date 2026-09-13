import { For, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../Dialog';

/** Settings 专用遮罩：全透明，不遮挡侧栏 frost 预览。 */
export const settingsPanelOverlayClass = 'ui-settings-overlay';

export type SettingsPanelItem = {
  id: string;
  label: string;
  icon?: JSX.Element;
  disabled?: boolean;
};

export type SettingsPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: JSX.Element;
  items: SettingsPanelItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  children: JSX.Element;
  class?: string;
};

/** T3 · macOS 式偏好面板：左导航 + 右详情，无 store / 协议。 */
export const SettingsPanel: Component<SettingsPanelProps> = (props) => {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        size="preferences"
        overlayClass={settingsPanelOverlayClass}
        class={cn('ui-settings-panel ui-titlebar-no-drag', props.class)}
        data-testid="settings-panel"
      >
        <header class="ui-settings-header">
          <DialogTitle>{props.title}</DialogTitle>
          <DialogClose />
        </header>
        <div class="ui-settings-body">
          <nav class="ui-settings-nav" aria-label="Settings">
            <For each={props.items}>
              {(item) => {
                const selected = () => item.id === props.selectedId;
                return (
                  <button
                    type="button"
                    class="ui-settings-nav-item"
                    aria-current={selected() ? 'page' : undefined}
                    disabled={item.disabled}
                    data-testid={`settings-nav-${item.id}`}
                    onClick={() => props.onSelect(item.id)}
                  >
                    <ShowIcon icon={item.icon} />
                    <span class="min-w-0 truncate text-13">{item.label}</span>
                  </button>
                );
              }}
            </For>
          </nav>
          <section class="ui-settings-detail" data-testid="settings-detail">
            {props.children}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
};

function ShowIcon(props: { icon?: JSX.Element }) {
  return props.icon ? <span class="ui-settings-nav-icon">{props.icon}</span> : null;
}
