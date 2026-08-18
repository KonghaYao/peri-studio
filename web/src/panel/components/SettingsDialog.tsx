// peri-studio Web 面板 —— 系统信息弹窗。
//
// 这里展示只读运行拓扑和版本信息，不承载可修改偏好，因此界面使用
// “System”语义，避免把诊断信息伪装成 Settings。

import { createSignal, For, Show } from 'solid-js';
import { Dialog } from '../../ui';
import { connState } from '../lib/connection';
import { globalStatus, schemaVersion } from '../store';
import { serverStatusLabel } from '../lib/topology-view';
import { TopologyView } from './TopologyView';

type SettingsTab = 'topology' | 'about';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'topology', label: 'Topology' },
  { id: 'about', label: 'About' },
];

export function SettingsDialog(props: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = createSignal<SettingsTab>('topology');
  return (
    <Dialog open={props.open} title="System" onClose={props.onClose}>
      <div class="settings-dialog w-(--container-settings) max-h-(--container-settings-tall) overflow-auto px-22 pb-22">
        <div class="settings-tabs sticky top-0 z-1 flex gap-18 -mx-22 px-22 border-b border-divider bg-surface" role="tablist" aria-label="Settings categories">
          <For each={TABS}>{(item) => (
            <button
              type="button"
              role="tab"
              id={`settings-tab-${item.id}`}
              aria-selected={tab() === item.id}
              aria-controls={`settings-panel-${item.id}`}
              class="settings-tab px-2 pt-14 pb-11 border-0 border-b-2 border-b-transparent bg-none text-text-muted text-13 cursor-pointer hover:text-text-primary"
              classList={{ 'is-selected': tab() === item.id }}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          )}</For>
        </div>
        <div role="tabpanel" id="settings-panel-topology" aria-labelledby="settings-tab-topology" hidden={tab() !== 'topology'}>
          <p class="settings-panel-note mt-13 text-text-muted text-12 leading-15">Read-only view: shows the running instances and mounted conversations for the current server connection; state is maintained live by the server.</p>
          <TopologyView />
        </div>
        <div role="tabpanel" id="settings-panel-about" aria-labelledby="settings-tab-about" hidden={tab() !== 'about'}>
          <Show when={tab() === 'about'}>
            <dl class="about-list grid grid-cols-settings-form gap-x-12 gap-y-9 mt-16 p-15 border border-divider rounded-12 bg-surface-muted">
              <dt>WebSocket connection</dt>
              <dd>{connState().text}</dd>
              <dt>Server health</dt>
              <dd>{serverStatusLabel(globalStatus())}</dd>
              <dt>Registry schema version</dt>
              <dd>{String(schemaVersion() ?? '—')}</dd>
            </dl>
            <p class="settings-panel-note mt-13 text-text-muted text-12 leading-15">Instance and conversation metadata comes from the hub:registry projection; the topology panel does not issue extra requests to the server.</p>
          </Show>
        </div>
      </div>
    </Dialog>
  );
}
