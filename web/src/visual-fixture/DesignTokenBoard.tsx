import { For } from 'solid-js';
import { Badge, Button, IconButton, Textarea } from '../components/ui';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  CodeXml,
  File,
  FileText,
  Folder,
  GitBranch,
  Image,
  Link2,
  ListTodo,
  Mic,
  Plus,
  Send,
  ShieldCheck,
  Workflow,
  X,
} from 'lucide-solid';

const colors = [
  { name: 'Canvas', token: '--surface', value: '#FFFFFF', class: 'surface' },
  { name: 'Muted', token: '--surface-muted', value: '#FBFCFB', class: 'muted' },
  { name: 'Selected', token: '--selected', value: '#EFF8F3', class: 'selected' },
  { name: 'Border', token: '--border-subtle', value: '#ECEFEB', class: 'border' },
  { name: 'Ink', token: '--text-primary', value: '#202522', class: 'ink' },
  { name: 'Success', token: '--success', value: '#16A36A', class: 'success' },
  { name: 'Busy', token: '--warning', value: '#C77819', class: 'busy' },
] as const;

const icons = [
  { name: 'Folder', icon: Folder },
  { name: 'File', icon: File },
  { name: 'Code', icon: CodeXml },
  { name: 'Git', icon: GitBranch },
  { name: 'Todo', icon: ListTodo },
  { name: 'Agent', icon: Bot },
  { name: 'Workflow', icon: Workflow },
  { name: 'Send', icon: Send },
] as const;

function Section(props: { label: string; title: string; children: unknown }) {
  return <section class="token-section">
    <header class="token-section__head"><code>{props.label}</code><h2>{props.title}</h2></header>
    {props.children as never}
  </section>;
}

function StatusMark(props: { state: 'done' | 'busy' | 'queued' }) {
  if (props.state === 'done') return <Check size={14} strokeWidth={2.3} class="token-success" />;
  return <Circle size={props.state === 'busy' ? 11 : 10} strokeWidth={2} class={props.state === 'busy' ? 'token-success' : 'token-faint'} />;
}

function AssetTile(props: { kind: 'image' | 'file' | 'reference'; name: string }) {
  const AssetIcon = props.kind === 'image' ? Image : props.kind === 'reference' ? Link2 : FileText;
  return <article class="token-asset">
    <IconButton label={`Remove ${props.name}`} class="token-asset__remove"><X size={11} strokeWidth={2} /></IconButton>
    {props.kind === 'image'
      ? <div class="token-asset__preview"><span /></div>
      : <AssetIcon size={21} strokeWidth={1.7} class="token-asset__icon" />}
    <strong title={props.name}>{props.name}</strong>
  </article>;
}

export function DesignTokenBoard() {
  return <main class="design-token-page">
    <div class="design-token-board">
      <header class="design-token-board__hero">
        <div><h1>Peri Studio · Design tokens</h1><p>White-first interface system · compact, quiet, tool-native</p></div>
        <code>Foundation 01</code>
      </header>

      <Section label="Foundation" title="Color palette">
        <div class="token-palette"><For each={colors}>{(color) => <article class="token-swatch">
          <div class={`token-swatch__color token-swatch__color--${color.class}`} />
          <strong>{color.name}</strong><code>{color.token}</code><small>{color.value}</small>
        </article>}</For></div>
      </Section>

      <Section label="Foundation" title="Typography & geometry">
        <div class="token-grid token-grid--two">
          <article class="token-card"><h3>Type scale</h3>
            <div class="token-type-row"><code>22 / 28</code><strong class="token-type-display">Page title</strong><small>720</small></div>
            <div class="token-type-row"><code>15 / 22</code><strong class="token-type-heading">Section heading</strong><small>680</small></div>
            <div class="token-type-row"><code>13 / 20</code><span>Primary interface copy</span><small>400</small></div>
            <div class="token-type-row"><code>11 / 16</code><span class="token-muted">Metadata & labels</span><small>500</small></div>
          </article>
          <article class="token-card"><h3>Spacing · radius · elevation</h3>
            <div class="token-spacing"><For each={[4, 6, 8, 12, 16, 20, 28]}>{(value) => <span><i style={{ height: `${value}px` }} /><code>{value}</code></span>}</For></div>
            <div class="token-radii"><For each={[6, 10, 14, 20]}>{(value) => <span style={{ 'border-radius': `${value}px` }}>{value}</span>}</For></div>
            <div class="token-shadows"><span>Float</span><span>Overlay</span></div>
          </article>
        </div>
      </Section>

      <Section label="Primitives" title="Controls & states">
        <div class="token-grid token-grid--two">
          <article class="token-card"><h3>Buttons · fields · badges</h3>
            <div class="token-controls">
              <Button variant="primary" size="compact">Continue</Button>
              <Button size="compact">Cancel</Button>
              <Button variant="ghost" size="compact">Skip</Button>
              <IconButton label="Add"><Plus size={16} /></IconButton>
              <Badge tone="ok">Done</Badge><Badge tone="warn">Running</Badge><Badge tone="neutral">Queued</Badge>
            </div>
            <div class="token-fields"><input aria-label="Default field example" placeholder="Message Agent…" /><input aria-label="Focused field example" value="Focused input" readOnly /></div>
          </article>
          <article class="token-card"><h3>Lucide icon family</h3>
            <div class="token-icon-grid"><For each={icons}>{(item) => <div><item.icon size={18} strokeWidth={1.7} /><small>{item.name}</small></div>}</For></div>
          </article>
        </div>
      </Section>

      <Section label="Patterns" title="Compact interaction patterns">
        <div class="token-grid token-grid--two">
          <article class="token-card"><h3>Tool activity · max 740px</h3>
            <div class="token-tool-list">
              <div><StatusMark state="done" /><strong>Search runtime binding</strong><code>server/src</code><small>Done</small><CodeXml size={14} /></div>
              <div><StatusMark state="done" /><strong>Update boundary</strong><code>web/src/panel/store.ts</code><small>Done</small><CodeXml size={14} /></div>
              <div class="is-active"><StatusMark state="busy" /><strong>Run focused checks</strong><code>bun run test</code><small>Running</small><CodeXml size={14} /></div>
            </div>
          </article>
          <article class="token-card"><h3>Status Area</h3>
            <div class="token-status-area"><div class="token-tabs"><button type="button" class="is-active"><ListTodo size={13} />Todo <small>1/3</small></button><button type="button"><Workflow size={13} />Async <small>2</small></button><button type="button"><GitBranch size={13} />Changes <small>3</small></button></div>
              <div class="token-status-list"><div><StatusMark state="done" /><span>Locate recovery boundary</span><small>Done</small></div><div><StatusMark state="busy" /><span>Verify browser projection</span><small>Running</small></div><div><StatusMark state="queued" /><span>Summarize focused checks</span><small>Queued</small></div></div>
            </div>
          </article>
          <article class="token-card"><h3>VS Code-like file tree</h3>
            <div class="token-tree"><div class="is-selected"><ChevronRight size={14} /><Folder size={15} /><strong>src</strong></div><div><ChevronDown size={14} /><Folder size={15} /><strong>web</strong></div><div class="is-nested"><File size={14} /><span>Composer.tsx</span><code>M</code></div><div class="is-nested"><File size={14} /><span>StatusArea.tsx</span><code class="token-success">U</code></div></div>
          </article>
          <article class="token-card"><h3>Assets · 68px</h3><div class="token-assets"><AssetTile kind="image" name="chat-layout-reference-final.png" /><AssetTile kind="file" name="status-area.md" /><AssetTile kind="reference" name="Reference 1" /></div></article>
        </div>
      </Section>

      <Section label="Modules" title="Composer shell">
        <div class="token-composer">
          <div class="token-assets"><AssetTile kind="image" name="layout.png" /><AssetTile kind="file" name="spec.md" /></div>
          <Textarea aria-label="Composer example" placeholder="Message Agent…" variant="bare" rows={2} />
          <footer><IconButton label="Add attachment"><Plus size={17} /></IconButton><IconButton label="Approval mode"><Check size={16} /></IconButton><span class="token-composer__spacer" /><Badge tone="ok">Nova 4.1</Badge><IconButton label="Voice input"><Mic size={17} /></IconButton><IconButton label="Send" variant="primary"><Send size={17} /></IconButton></footer>
        </div>
      </Section>

      <Section label="Modules" title="Decision surfaces">
        <div class="token-decision-grid">
          <article class="token-decision">
            <header><strong>Questions</strong><span class="token-decision__pager"><IconButton label="Previous question" disabled><ChevronLeft size={13} /></IconButton><small>1 / 2</small><IconButton label="Next question"><ChevronRight size={13} /></IconButton></span><ChevronDown size={14} /></header>
            <div class="token-decision__body"><p>Which delivery path should we use?</p><button type="button" class="is-selected"><kbd>A</kbd><span><strong>Focused change</strong><small>Keep the current runtime boundary.</small></span><Check size={14} /></button><button type="button"><kbd>B</kbd><span><strong>Broader refactor</strong><small>Move the shared ownership seam.</small></span></button></div>
            <footer><Button variant="ghost" size="compact">Skip</Button><Button variant="primary" size="compact">Continue</Button></footer>
          </article>
          <article class="token-decision">
            <header><strong>Permissions</strong><span class="token-decision__pager"><small>1 / 2</small><IconButton label="Next permission"><ChevronRight size={13} /></IconButton></span><ShieldCheck size={14} class="token-warning" /></header>
            <div class="token-permission"><span class="token-permission__mark"><ShieldCheck size={15} /></span><div><strong>Modify workspace file</strong><p>web/src/panel/Composer.tsx</p></div><div class="token-permission__actions"><IconButton label="Allow" variant="primary"><Check size={15} /></IconButton><IconButton label="Deny"><X size={15} /></IconButton></div></div>
          </article>
        </div>
      </Section>
    </div>
  </main>;
}
