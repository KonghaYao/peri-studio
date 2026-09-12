import { createSignal } from 'solid-js';
import { Button } from '@/lib/catalog-ui';
import { InputGroup, InputGroupInput } from '@peri/ui';

/** Commit 输入：单行 InputGroup + 主按钮，Enter 提交。 */
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

  const commit = () => {
    if (!canCommit()) return;
    setMessage('');
  };

  return (
    <div class="px-8 pb-8">
      <InputGroup>
        <InputGroupInput
          aria-label="Commit message"
          placeholder="Message"
          value={message()}
          disabled={props.readOnly || props.busy}
          onInput={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            commit();
          }}
        />
        <Button
          variant="primary"
          size="sm"
          class="h-full rounded-none px-10"
          busy={props.busy}
          disabled={!canCommit()}
          onClick={commit}
        >
          Commit
        </Button>
      </InputGroup>
    </div>
  );
}
