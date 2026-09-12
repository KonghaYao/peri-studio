import { createSignal } from 'solid-js';
import {
  Badge,
  Button,
  ButtonGroup,
  buttonGroupItemClass,
  Checkbox,
  Dialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  InlineNotice,
  Input,
  RadioGroup,
  Select,
  Skeleton,
  Spinner,
  Status,
  Tabs,
  Textarea,
  Tooltip,
} from '@/lib/catalog-ui';
import { ComponentCatalogFeedback } from '@/pages/ComponentCatalogFeedback';
import { ComponentCatalogGaps } from '@/pages/ComponentCatalogGaps';
import { CatalogDemo, DemoRow, TierHeader } from '@/pages/shared/DemoSection';
import { Bell, Archive, Inbox, Mic, MoreHorizontal, Pencil, Pin, Plus, Search, Send, Settings, Trash2 } from 'lucide-solid';

/* Tier 2 · Base UI：基础组件的状态矩阵。 */

export function ComponentsPage() {
  const [checked, setChecked] = createSignal(true);
  const [radio, setRadio] = createSignal('focused');
  const [selected, setSelected] = createSignal('nova');
  const [tab, setTab] = createSignal('todo');
  const [dialogOpen, setDialogOpen] = createSignal(false);

  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Base UI"
        title="Base components"
        description="无业务语义的设计系统原语：Button、Input、Dialog 等。可被任意 Tier 3 块与 Tier 4 组合消费。"
      />

      <CatalogDemo id="button" title="Button" description="primary 实底白字（hover 浅一档）；default 白底灰边，hover 时边框与文字同时染主色。">
        <DemoRow label="Variants · md">
          <Button variant="primary">Continue</Button>
          <Button variant="default">Cancel</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">Delete</Button>
        </DemoRow>
        <DemoRow label="Sizes">
          <Button variant="primary" size="sm">Small 24</Button>
          <Button variant="primary" size="md">Middle 32</Button>
          <Button variant="primary" size="lg">Large 40</Button>
        </DemoRow>
        <DemoRow label="States">
          <Button variant="primary" busy>Saving</Button>
          <Button variant="default" disabled>Disabled</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </DemoRow>
      </CatalogDemo>

      <CatalogDemo id="icon-button" title="IconButton & Tooltip" description="圆角矩形（禁止圆形）；tooltip 为深色浮层。">
        <DemoRow>
          <IconButton label="Add attachment" tooltip="Add attachment"><Plus size={16} /></IconButton>
          <IconButton label="Search" tooltip="Search"><Search size={16} /></IconButton>
          <IconButton label="Settings" tooltip="Settings"><Settings size={16} /></IconButton>
          <IconButton label="Voice input" tooltip="Voice input" disabled><Mic size={16} /></IconButton>
          <IconButton label="Send" tooltip="Send" variant="primary"><Send size={16} /></IconButton>
        </DemoRow>
      </CatalogDemo>

      <CatalogDemo id="button-group" title="ButtonGroup" description="侧栏行 hover 操作：分段图标组，透明底、无阴影、无段间分隔线。">
        <DemoRow label="Session actions">
          <ButtonGroup aria-label="Session actions">
            <IconButton size="sm" showTooltip={false} label="Pin session" class={buttonGroupItemClass}><Pin size={14} strokeWidth={1.7} /></IconButton>
            <IconButton size="sm" showTooltip={false} label="Archive session" class={`${buttonGroupItemClass} text-content-muted hover:text-danger-solid`}><Archive size={14} strokeWidth={1.7} /></IconButton>
            <IconButton size="sm" showTooltip={false} label="More actions" class={buttonGroupItemClass}><MoreHorizontal size={14} strokeWidth={1.7} /></IconButton>
          </ButtonGroup>
        </DemoRow>
        <DemoRow label="Project actions">
          <ButtonGroup aria-label="Project actions">
            <IconButton size="sm" showTooltip={false} label="Project actions" class={buttonGroupItemClass}><MoreHorizontal size={14} strokeWidth={1.7} /></IconButton>
            <IconButton size="sm" showTooltip={false} label="New session" class={buttonGroupItemClass}><Plus size={14} strokeWidth={1.7} /></IconButton>
          </ButtonGroup>
        </DemoRow>
      </CatalogDemo>

      <CatalogDemo id="input" title="Input & Textarea" description="灰边 → hover 浅主色边 → focus 主色边；错误态走红族。">
        <div class="grid max-w-xl grid-cols-2 gap-12">
          <Input placeholder="Message the agent" />
          <Input value="Focused value" readOnly class="border-border-focus" />
          <Input placeholder="Error state" invalid />
          <Input placeholder="Disabled" disabled />
        </div>
        <Textarea rows={3} placeholder="Multi-line input…" class="max-w-xl" aria-label="Multi-line input" />
      </CatalogDemo>

      <CatalogDemo id="select" title="Select · Checkbox · Radio" description="Kobalte 基元保证键盘导航与焦点陷阱。">
        <div class="max-w-xs">
          <Select
            options={[
              { value: 'nova', label: 'Nova 4.1' },
              { value: 'gpt', label: 'gpt-5.6' },
              { value: 'claude', label: 'Claude Opus 4.6' },
            ]}
            value={selected()}
            onChange={setSelected}
            placeholder="Choose model"
          />
        </div>
        <DemoRow>
          <Checkbox label="Enable notifications" checked={checked()} onChange={setChecked} />
          <Checkbox label="Disabled" disabled />
        </DemoRow>
        <RadioGroup
          name="delivery"
          value={radio()}
          onChange={setRadio}
          options={[
            { value: 'focused', label: 'Focused change — keep the current boundary' },
            { value: 'broad', label: 'Broader refactor — move the shared seam' },
          ]}
        />
      </CatalogDemo>

      <CatalogDemo id="badge" title="Badge & Status" description="Badge 文字永远是中性灰，颜色由状态点承载（2026-08-30 定稿）。">
        <DemoRow label="Badges">
          <Badge tone="success">Done</Badge>
          <Badge tone="warning">Running</Badge>
          <Badge tone="danger">Failed</Badge>
          <Badge tone="info">Nova 4.1</Badge>
          <Badge tone="neutral">Queued</Badge>
        </DemoRow>
        <DemoRow label="Status">
          <Status tone="success" label="Connected" live />
          <Status tone="warning" label="Reconciling" />
          <Status tone="neutral" label="Idle" />
        </DemoRow>
      </CatalogDemo>

      <CatalogDemo id="tabs" title="Tabs" description="底部发丝线 + 激活项主色文字与底部指示条。">
        <div class="max-w-md">
          <Tabs
            value={tab()}
            onChange={setTab}
            tabs={[
              { value: 'todo', label: 'Todo 1/3' },
              { value: 'async', label: 'Async 2' },
              { value: 'changes', label: 'Changes 3' },
            ]}
          />
        </div>
      </CatalogDemo>

      <CatalogDemo id="dialog" title="Dialog & Dropdown" description="45% 遮罩、8px 圆角、overlay 阴影；菜单项 hover 中性灰。">
        <DemoRow>
          <Button variant="primary" onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <DropdownMenu
            label="Session actions"
            trigger={<Button variant="default">Session actions</Button>}
            items={[
              { id: 'rename', label: 'Rename session', icon: <Pencil size={14} /> },
              { id: 'notify', label: 'Notification settings', icon: <Bell size={14} /> },
              { id: 'delete', label: 'Delete session', icon: <Trash2 size={14} />, danger: true },
            ]}
          />
        </DemoRow>
        <Dialog
          open={dialogOpen()}
          onOpenChange={setDialogOpen}
          title="Archive project"
          footer={
            <>
              <Button variant="default" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setDialogOpen(false)}>Archive</Button>
            </>
          }
        >
          Archived projects keep their sessions but disappear from the sidebar. You can restore them anytime from Settings.
        </Dialog>
      </CatalogDemo>

      <CatalogDemo id="inline-notice" title="InlineNotice" description="白底 + 色边 + 色图标，不用 soft 填充。">
        <div class="flex max-w-xl flex-col gap-10">
          <InlineNotice tone="info" title="Delivery unknown">The message may already have executed. Resending stays disabled to avoid duplicates.</InlineNotice>
          <InlineNotice tone="success" title="Build passed">All 42 contract tests green in 38s.</InlineNotice>
          <InlineNotice tone="warning" title="Context almost full">182k/200k tokens used in this turn.</InlineNotice>
          <InlineNotice tone="danger" title="Runtime interrupted">The ACP process exited before confirming the last command.</InlineNotice>
        </div>
      </CatalogDemo>

      <CatalogDemo id="spinner" title="Spinner, Skeleton & EmptyState">
        <DemoRow>
          <Spinner class="text-accent-solid" />
          <Spinner class="text-content-muted" />
          <span class="text-12 text-content-muted">Loading…</span>
        </DemoRow>
        <DemoRow label="Shimmer">
          <div class="flex w-300 flex-col gap-8">
            <Skeleton class="h-12 w-180" />
            <Skeleton class="h-12 w-240" />
            <Skeleton class="h-12 w-210" />
          </div>
        </DemoRow>
        <div class="max-w-sm rounded-lg border border-border-subtle">
          <EmptyState
            icon={<Inbox size={28} strokeWidth={1.5} />}
            title="No conversations yet"
            description="Start a project session to create your first conversation."
            action={<Button variant="primary" size="sm">New session</Button>}
          />
        </div>
      </CatalogDemo>

      <ComponentCatalogFeedback sections={['message', 'button-variants', 'checkbox-radio', 'avatar-scroll-aspect', 'skeleton-loading', 'toggle-kbd-command', 'copy-link-terminal-git']} />
      <ComponentCatalogGaps sections={['checkbox-radio', 'avatar-scroll-aspect', 'skeleton-loading', 'toggle-kbd-command', 'copy-link-terminal-git']} />
    </div>
  );
}
