import { createSignal } from 'solid-js';
import { COMPOSER_ACTIVE_ATTACHMENTS } from './composer-shell-data';
import { chatColumnClass } from '@peri/ui';
import { ComposerShell } from './ComposerShell';

/** Tier 4 · Composer：单行紧凑 / 多行展开自动切换。 */
export function ComposerLayout() {
  const [draft, setDraft] = createSignal('');
  const [attachments, setAttachments] = createSignal<typeof COMPOSER_ACTIVE_ATTACHMENTS>([]);

  const toggleDemoAttachments = () => {
    setAttachments((current) => (current.length > 0 ? [] : COMPOSER_ACTIVE_ATTACHMENTS));
  };

  return (
    <div class={`${chatColumnClass} relative flex flex-col gap-12`}>
      <p class="text-12 text-content-muted">
        Type a single line to stay compact; press Enter for a new line, add attachments, or wrap text to expand.
      </p>
      <ComposerShell
        draft={draft()}
        onDraftChange={setDraft}
        attachments={attachments()}
        attachmentLayout="chip"
        onUploadRequest={toggleDemoAttachments}
      />
    </div>
  );
}
