// peri-studio Web 面板 —— 系统信息弹窗。
//
// 这里展示只读运行拓扑和版本信息，不承载可修改偏好，因此界面使用
// “System”语义，避免把诊断信息伪装成 Settings。

import { createSignal, For, Show } from 'solid-js';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@peri/ui';
import { useAuthActions } from '@/features/auth/auth-hook';
import { principalId } from '@/features/auth/auth-state';
import { connState } from '@/features/connection/connection';
import { TopologyView } from '@/widgets/chat/TopologyView';
import { MachinePanel } from '@/widgets/resource/MachinePanel';
import { ThisBrowserBlock } from './ThisBrowserBlock';

type SettingsTab = 'machines' | 'about';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'machines', label: 'Machines' },
  { id: 'about', label: 'About' },
];

export function SettingsDialog(props: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = createSignal<SettingsTab>('machines');
  const auth = useAuthActions();
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
            <p class="mt-14 mb-0 font-mono text-12 text-text-muted">{connState().text}</p>
            <ThisBrowserBlock />
            <TopologyView />
            <Show when={principalId() && auth?.logout}>
              <div class="mt-16 flex justify-end border-t border-divider pt-16">
                <Button variant="secondary" size="compact" onClick={() => auth?.logout()}>
                  Log out
                </Button>
              </div>
            </Show>
          </TabsContent>
        </div>
      </Tabs>
    </DialogContent></Dialog>
  );
}
