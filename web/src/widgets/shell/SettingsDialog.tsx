// peri-studio Web 面板 —— 系统信息弹窗。
//
// 这里展示只读运行拓扑和版本信息，不承载可修改偏好，因此界面使用
// “System”语义，避免把诊断信息伪装成 Settings。

import { createSignal, For } from 'solid-js';
import { Dialog, DialogContent, DialogTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui';
import { connState } from '@/features/connection/connection';
import { globalStatus, schemaVersion } from '../../panel/store';
import { serverStatusLabel } from '@/entities/topology/topology-view';
import { MachinePanel } from '@/widgets/resource/MachinePanel';

type SettingsTab = 'machines' | 'about';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'machines', label: 'Machines' },
  { id: 'about', label: 'About' },
];

export function SettingsDialog(props: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = createSignal<SettingsTab>('machines');
  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose(); }}><DialogContent size="settings"><DialogTitle class="sr-only">System</DialogTitle>
      <Tabs value={tab()} onChange={(value) => setTab(value as SettingsTab)}>
        <div class="px-22 pb-22">
          <TabsList class="sticky top-0 z-1 flex gap-18 -mx-22 px-22 border-b border-divider bg-surface" aria-label="Settings categories">
            <For each={TABS}>{(item) => <TabsTrigger value={item.id} class="px-2 pt-14 pb-11 text-13">{item.label}</TabsTrigger>}</For>
          </TabsList>
          <TabsContent value="machines">
            <div class="mt-14 min-h-240 overflow-hidden rounded-12 border border-divider bg-surface">
              <MachinePanel />
            </div>
          </TabsContent>
          <TabsContent value="about">
            <dl class="settings-form-meta grid grid-cols-settings-form gap-x-12 gap-y-9 mt-16 p-15 border border-divider rounded-12 bg-surface-muted">
              <dt>WebSocket connection</dt>
              <dd>{connState().text}</dd>
              <dt>Server health</dt>
              <dd>{serverStatusLabel(globalStatus())}</dd>
              <dt>Registry schema version</dt>
              <dd>{String(schemaVersion() ?? '—')}</dd>
            </dl>
            <p class="mt-13 text-text-muted text-12 leading-15">Instance and conversation metadata comes from the hub:registry projection; the topology panel does not issue extra requests to the server.</p>
          </TabsContent>
        </div>
      </Tabs>
    </DialogContent></Dialog>
  );
}
