import { createSignal, For, Show, type JSX } from 'solid-js';
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
  Spinner,
  Status,
  Tabs,
  Textarea,
  Tooltip,
} from '@/components/ui';
import { TierHeader } from '@/pages/shared/DemoSection';
import { Bell, Archive, Inbox, Mic, MoreHorizontal, Pencil, Pin, Plus, Search, Send, Settings, Trash2 } from 'lucide-solid';

/* Tier 2 · Base UI：AntD 方向基础组件的状态矩阵。 */

function Demo(props: { id: string; title: string; description?: string; children: unknown }) {
  return (
    <section id={props.id} class="demo-scroll-anchor border-b border-border-subtle px-4 py-7 diff-min:px-8">
      <h2 class="text-15 font-semibold text-content-primary">{props.title}</h2>
      {props.description && <p class="mt-1 max-w-2xl text-12 leading-normal text-content-muted">{props.description}</p>}
      <div class="mt-4 flex flex-col gap-4">{props.children as never}</div>
    </section>
  );
}

function Row(props: { label?: string; children: JSX.Element }) {
  return (
    <div>
      {props.label && <div class="mb-1.5 text-10 font-medium tracking-caps uppercase text-content-faint">{props.label}</div>}
      <div class="flex flex-wrap items-center gap-3">{props.children}</div>
    </div>
  );
}

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

      <Demo id="button" title="Button" description="primary 实底白字（hover 浅一档）；default 白底灰边，hover 边框与文字同时染主色（AntD 签名行为）。">
        <Row label="Variants · md">
          <Button variant="primary">Continue</Button>
          <Button variant="default">Cancel</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">Delete</Button>
        </Row>
        <Row label="Sizes">
          <Button variant="primary" size="sm">Small 24</Button>
          <Button variant="primary" size="md">Middle 32</Button>
          <Button variant="primary" size="lg">Large 40</Button>
        </Row>
        <Row label="States">
          <Button variant="primary" busy>Saving</Button>
          <Button variant="default" disabled>Disabled</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </Row>
      </Demo>

      <Demo id="icon-button" title="IconButton & Tooltip" description="圆角矩形（禁止圆形）；tooltip 为 AntD 风格深色浮层。">
        <Row>
          <IconButton label="Add attachment" tooltip="Add attachment"><Plus size={16} /></IconButton>
          <IconButton label="Search" tooltip="Search"><Search size={16} /></IconButton>
          <IconButton label="Settings" tooltip="Settings"><Settings size={16} /></IconButton>
          <IconButton label="Voice input" tooltip="Voice input" disabled><Mic size={16} /></IconButton>
          <IconButton label="Send" tooltip="Send" class="bg-accent-solid text-content-on-accent hover:bg-accent-hover hover:text-content-on-accent"><Send size={16} /></IconButton>
        </Row>
      </Demo>

      <Demo id="button-group" title="ButtonGroup" description="侧栏行 hover 操作：分段图标组，段间竖线、透明底、无阴影。">
        <Row label="Session actions">
          <ButtonGroup aria-label="Session actions">
            <IconButton size="sm" showTooltip={false} label="Pin session" class={buttonGroupItemClass}><Pin size={14} strokeWidth={1.7} /></IconButton>
            <IconButton size="sm" showTooltip={false} label="Archive session" class={`${buttonGroupItemClass} text-content-muted hover:text-danger-solid`}><Archive size={14} strokeWidth={1.7} /></IconButton>
            <IconButton size="sm" showTooltip={false} label="More actions" class={buttonGroupItemClass}><MoreHorizontal size={14} strokeWidth={1.7} /></IconButton>
          </ButtonGroup>
        </Row>
        <Row label="Project actions">
          <ButtonGroup aria-label="Project actions">
            <IconButton size="sm" showTooltip={false} label="Project actions" class={buttonGroupItemClass}><MoreHorizontal size={14} strokeWidth={1.7} /></IconButton>
            <IconButton size="sm" showTooltip={false} label="New session" class={buttonGroupItemClass}><Plus size={14} strokeWidth={1.7} /></IconButton>
          </ButtonGroup>
        </Row>
      </Demo>

      <Demo id="input" title="Input & Textarea" description="灰边 → hover 浅主色边 → focus 主色边 + 浅光晕；错误态走红族。">
        <div class="grid max-w-xl grid-cols-2 gap-3">
          <Input placeholder="Message the agent" />
          <Input value="Focused value" readOnly class="border-border-focus shadow-(--shadow-focus-ring)" />
          <Input placeholder="Error state" invalid />
          <Input placeholder="Disabled" disabled />
        </div>
        <Textarea rows={3} placeholder="Multi-line input…" class="max-w-xl" />
      </Demo>

      <Demo id="select" title="Select · Checkbox · Radio" description="Kobalte 基元保证键盘导航与焦点陷阱。">
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
        <Row>
          <Checkbox label="Enable notifications" checked={checked()} onChange={setChecked} />
          <Checkbox label="Disabled" disabled />
        </Row>
        <RadioGroup
          name="delivery"
          value={radio()}
          onChange={setRadio}
          options={[
            { value: 'focused', label: 'Focused change — keep the current boundary' },
            { value: 'broad', label: 'Broader refactor — move the shared seam' },
          ]}
        />
      </Demo>

      <Demo id="badge" title="Badge & Status" description="Badge 文字永远是中性灰，颜色由状态点承载（2026-08-30 定稿）。">
        <Row label="Badges">
          <Badge tone="success">Done</Badge>
          <Badge tone="warning">Running</Badge>
          <Badge tone="danger">Failed</Badge>
          <Badge tone="info">Nova 4.1</Badge>
          <Badge tone="neutral">Queued</Badge>
        </Row>
        <Row label="Status">
          <Status tone="success" label="Connected" live />
          <Status tone="warning" label="Reconciling" />
          <Status tone="neutral" label="Idle" />
        </Row>
      </Demo>

      <Demo id="tabs" title="Tabs" description="底部发丝线 + 激活项主色文字与指示条（AntD line 风格）。">
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
      </Demo>

      <Demo id="dialog" title="Dialog & Dropdown" description="45% 遮罩、8px 圆角、overlay 阴影；菜单项 hover 中性灰。">
        <Row>
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
        </Row>
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
      </Demo>

      <Demo id="inline-notice" title="InlineNotice" description="白底 + 色边 + 色图标，不用 soft 填充。">
        <div class="flex max-w-xl flex-col gap-2.5">
          <InlineNotice tone="info" title="Delivery unknown">The message may already have executed. Resending stays disabled to avoid duplicates.</InlineNotice>
          <InlineNotice tone="success" title="Build passed">All 42 contract tests green in 38s.</InlineNotice>
          <InlineNotice tone="warning" title="Context almost full">182k/200k tokens used in this turn.</InlineNotice>
          <InlineNotice tone="danger" title="Runtime interrupted">The ACP process exited before confirming the last command.</InlineNotice>
        </div>
      </Demo>

      <Demo id="spinner" title="Spinner & EmptyState">
        <Row>
          <Spinner class="text-accent-solid" />
          <Spinner class="text-content-muted" />
          <span class="text-12 text-content-muted">Loading…</span>
        </Row>
        <div class="max-w-sm rounded-lg border border-border-subtle">
          <EmptyState
            icon={<Inbox size={28} strokeWidth={1.5} />}
            title="No conversations yet"
            description="Start a project session to create your first conversation."
            action={<Button variant="primary" size="sm">New session</Button>}
          />
        </div>
      </Demo>
    </div>
  );
}
