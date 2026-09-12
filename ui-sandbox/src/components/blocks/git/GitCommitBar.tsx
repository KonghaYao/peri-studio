import { createSignal } from 'solid-js';
import { Button } from '@/lib/catalog-ui';
import { cn } from '@/lib/catalog-ui';

/** Commit 输入：sidebar 密度，无厚重边框控件。 */
export function GitCommitBar(props: {
  stagedCount: number;
  busy?: boolean;
  readOnly?: boolean;
}) {
  const [message, setMessage] = createSignal('');
  const canCommit = () =>
    !props.readOnly
    && !props.busy
    && props.stagedCount > 0
    && message().trim().length > 0;

  return (
    <div class="px-2.5 pb-2">
      <textarea
        aria-label="Commit message"
        placeholder="Commit message"
        rows={2}
        value={message()}
        disabled={props.readOnly || props.busy}
        onInput={(event) => setMessage(event.currentTarget.value)}
        class={cn(
          'box-border w-full min-h-9 resize-none rounded-md border-0 bg-surface-sunken px-2.5 py-2',
          'text-12 leading-snug text-content-primary outline-none placeholder:text-content-faint',
          'focus-visible:shadow-(--shadow-focus-ring)',
          'disabled:cursor-not-allowed disabled:opacity-45',
        )}
      />
      <Button
        variant="primary"
        size="sm"
        class="mt-1.5 w-full"
        busy={props.busy}
        disabled={!canCommit()}
      >
        Commit
      </Button>
    </div>
  );
}
