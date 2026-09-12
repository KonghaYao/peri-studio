import { createSignal } from 'solid-js';
import { TokenUsageMeter, UploadAssetTile } from '@/components/blocks/composer';
import { IconButton, Select, Textarea } from '@/lib/catalog-ui';
import { Mic, Plus, Send, ShieldCheck } from 'lucide-solid';

/** Tier 4 · Composer 输入区组合。 */
export function ComposerLayout() {
  const [model, setModel] = createSignal('nova');

  return (
    <div class="chat-column">
      <div
        data-testid="composer-surface"
        class="composer-surface border border-composer-border bg-surface-overlay p-2.5"
        style={{ 'border-radius': 'var(--composer-radius)' }}
      >
        <div class="mb-1 flex gap-2">
          <UploadAssetTile name="layout.png" status="ready" onRemove={() => {}} />
          <UploadAssetTile name="spec.md" status="ready" onRemove={() => {}} />
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
          <IconButton label="Send" tooltip="Send" variant="primary"><Send size={16} /></IconButton>
        </div>
      </div>
    </div>
  );
}
