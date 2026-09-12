import { createSignal } from 'solid-js';
import { TokenUsageMeter, UploadAssetTile } from '@/components/blocks/composer';
import { IconButton, Select, Textarea } from '@/lib/catalog-ui';
import { Mic, Plus, Send, ShieldCheck } from 'lucide-solid';
import {
  composerAssetRowClass,
  composerFieldClass,
  composerSurfaceClass,
  composerToolbarClass,
} from './composer-demo-classes';

/** Tier 4 · Composer 输入区组合。 */
export function ComposerLayout() {
  const [model, setModel] = createSignal('nova');

  return (
    <div class="chat-column">
      <div data-testid="composer-surface" class={composerSurfaceClass}>
        <div class={composerAssetRowClass}>
          <UploadAssetTile name="layout.png" status="ready" onRemove={() => {}} />
          <UploadAssetTile name="spec.md" status="ready" onRemove={() => {}} />
        </div>
        <Textarea
          variant="bare"
          autoResize
          maxHeight={180}
          rows={2}
          placeholder="Message the agent"
          aria-label="Message the agent"
          class={composerFieldClass}
        />
        <div class={composerToolbarClass}>
          <IconButton label="Add attachment" tooltip="Add attachment"><Plus size={16} /></IconButton>
          <IconButton label="Approval mode" tooltip="Approval mode"><ShieldCheck size={16} /></IconButton>
          <span class="flex-1" />
          <Select
            variant="plain"
            aria-label="Model"
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
