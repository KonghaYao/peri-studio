import { createSignal, Show } from 'solid-js';
import { Button } from '../Button';
import { InputGroup, InputGroupInput } from '../InputGroup';
import { Textarea } from '../Textarea';

export type GitCommitShortcut = 'enter' | 'mod+enter';

function matchesCommitShortcut(event: KeyboardEvent, shortcut: GitCommitShortcut) {
  if (shortcut === 'mod+enter') {
    return (event.ctrlKey || event.metaKey) && event.key === 'Enter';
  }
  return event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function messageByteLength(value: string) {
  return new TextEncoder().encode(value.trim()).byteLength;
}

/** Commit 输入：单行 InputGroup 或多行 Textarea + 主按钮。 */
export function GitCommitBar(props: {
  stagedCount: number;
  value?: string;
  onValueChange?: (value: string) => void;
  onCommit?: () => void;
  rows?: number;
  maxBytes?: number;
  commitShortcut?: GitCommitShortcut;
  onKeyDown?: (event: KeyboardEvent) => void;
  placeholder?: string;
  busy?: boolean;
  commitBusy?: boolean;
  readOnly?: boolean;
  commitDisabled?: boolean;
  class?: string;
}) {
  const [internalMessage, setInternalMessage] = createSignal('');
  const controlled = () => props.value !== undefined;
  const message = () => (controlled() ? props.value! : internalMessage());
  const setMessage = (value: string) => {
    if (!controlled()) setInternalMessage(value);
    props.onValueChange?.(value);
  };
  const rows = () => props.rows ?? 1;
  const multiline = () => rows() > 1;
  const shortcut = () => props.commitShortcut ?? (multiline() ? 'mod+enter' : 'enter');
  const messageTooLarge = () => props.maxBytes != null && messageByteLength(message()) > props.maxBytes;
  const canCommit = () =>
    !props.readOnly
    && !props.busy
    && !props.commitDisabled
    && props.stagedCount > 0
    && message().trim().length > 0
    && !messageTooLarge();

  const commit = () => {
    if (!canCommit()) return;
    props.onCommit?.();
    if (!controlled() && !props.onCommit) setInternalMessage('');
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (!matchesCommitShortcut(event, shortcut())) return;
    event.preventDefault();
    commit();
  };

  const placeholder = () =>
    props.placeholder
    ?? (shortcut() === 'mod+enter' ? 'Message (Ctrl+Enter to commit)' : 'Message');

  const validationMessage = () =>
    props.maxBytes != null
      ? `Commit message must be at most ${props.maxBytes.toLocaleString()} UTF-8 bytes.`
      : undefined;

  return (
    <div class={props.class ?? 'px-8 pb-8'}>
      <Show
        when={multiline()}
        fallback={(
          <InputGroup>
            <InputGroupInput
              aria-label="Commit message"
              placeholder={placeholder()}
              value={message()}
              disabled={props.readOnly || props.busy}
              onInput={(event) => setMessage(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
            />
            <Button
              variant="primary"
              size="sm"
              class="h-full rounded-none px-10"
              busy={props.commitBusy}
              disabled={!canCommit()}
              aria-label="Commit staged changes"
              onClick={commit}
            >
              Commit
            </Button>
          </InputGroup>
        )}
      >
        <Textarea
          aria-label="Commit message"
          placeholder={placeholder()}
          rows={rows()}
          value={message()}
          disabled={props.readOnly || props.busy}
          onInput={(event) => setMessage(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          class="min-h-52 text-11 leading-16"
        />
        <Show when={messageTooLarge()}>
          <div role="alert" class="mt-4 text-10 leading-14 text-danger-solid">
            {validationMessage()}
          </div>
        </Show>
        <Button
          variant="primary"
          size="compact"
          class="mt-8 w-full min-h-28! text-11! pointer-coarse:min-h-44!"
          busy={props.commitBusy}
          disabled={!canCommit()}
          aria-label="Commit staged changes"
          onClick={commit}
        >
          Commit
        </Button>
      </Show>
      <Show when={!multiline() && messageTooLarge()}>
        <div role="alert" class="mt-4 text-10 leading-14 text-danger-solid">
          {validationMessage()}
        </div>
      </Show>
    </div>
  );
}
