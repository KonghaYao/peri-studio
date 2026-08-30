import { createSignal, For } from 'solid-js';
import { TokenUsageMeter } from '@/components/blocks/composer';
import { IconButton, Select, Textarea } from '@/components/ui';
import { FileText, Image as ImageIcon, Mic, Plus, Send, ShieldCheck, X } from 'lucide-solid';

/** Tier 4 · Composer 输入区组合。 */
export function ComposerLayout() {
  const [model, setModel] = createSignal('nova');

  return (
    <div class="chat-column">
      <div class="border border-composer-border bg-surface-overlay p-2.5" style={{ 'border-radius': 'var(--composer-radius)' }}>
      <div class="mb-1 flex gap-2">
        <For each={[{ icon: 'image', name: 'layout.png' }, { icon: 'file', name: 'spec.md' }]}>
          {(asset) => (
            <div
              class="relative grid flex-none grid-rows-asset-tile overflow-hidden rounded-md border border-border-subtle bg-surface-canvas p-1.5"
              style={{ width: 'var(--resource-asset-tile)', height: 'var(--resource-asset-tile)' }}
            >
              <IconButton label={`Remove ${asset.name}`} size="sm" class="absolute top-0.5 right-0.5 size-5 bg-surface-overlay/90"><X size={11} /></IconButton>
              <span class="grid place-items-center text-content-muted">
                {asset.icon === 'image' ? <ImageIcon size={20} strokeWidth={1.6} /> : <FileText size={20} strokeWidth={1.6} />}
              </span>
              <span class="truncate text-9 text-content-secondary">{asset.name}</span>
            </div>
          )}
        </For>
      </div>
      <Textarea rows={2} placeholder="Message the agent" class="border-0 bg-transparent px-1 shadow-none hover:border-transparent focus:border-transparent focus:shadow-none" />
      <div class="flex items-center gap-1">
        <IconButton label="Add attachment" tooltip="Add attachment"><Plus size={16} /></IconButton>
        <IconButton label="Approval mode" tooltip="Approval mode"><ShieldCheck size={16} /></IconButton>
        <span class="flex-1" />
        <Select
          variant="plain"
          value={model()}
          onChange={setModel}
          options={[
            { value: 'nova', label: 'Nova 4.1' },
            { value: 'gpt', label: 'gpt-5.6' },
            { value: 'claude', label: 'Claude Opus 4.6' },
          ]}
        />
        <TokenUsageMeter input={12400} output={3180} cached={8200} />
        <IconButton label="Voice input" tooltip="Voice input" disabled><Mic size={16} /></IconButton>
        <IconButton label="Send" tooltip="Send" class="bg-accent-solid text-content-on-accent hover:bg-accent-hover hover:text-content-on-accent"><Send size={16} /></IconButton>
      </div>
      </div>
    </div>
  );
}
