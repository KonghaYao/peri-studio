import {
  Check,
  Copy,
  History,
} from 'lucide-solid';
import {
  createMemo,
  createSignal,
  For,
  Show,
  type Component,
} from 'solid-js';
import {
  extractParts,
  type ChatMessage,
} from '../../lib/chat-payload';
import {
  enrichPartsWithToolResults,
  prepareChatIoMessages,
} from '../../lib/chat-io-tool-pairing';
import { cn } from '../../lib/cn';
import { Button } from '../Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../Dialog';
import { ChatIoPartView } from './ChatIoParts';
import { chatIoRoleConfig } from './chat-io-role-config';

/** 初始可见消息数（从末尾算起）。 */
const INITIAL_VISIBLE = 20;
/** 每次「加载更早」追加条数。 */
const LOAD_STEP = 50;

type ChatIoMessageJsonDialogProps = {
  message: ChatMessage;
  index: number;
};

const ChatIoMessageJsonDialog: Component<ChatIoMessageJsonDialogProps> = (props) => {
  const [copied, setCopied] = createSignal(false);
  const json = createMemo(() => {
    try {
      return JSON.stringify(props.message.raw, null, 2);
    } catch {
      return String(props.message.raw);
    }
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <Dialog>
      <DialogTrigger
        as="button"
        type="button"
        title="View raw JSON"
        aria-label="View raw JSON"
        class="ui-io-chat-json-trigger inline-flex items-center gap-2 rounded border px-4 py-1 font-mono text-9 font-600 text-content-muted opacity-0 transition-all group-hover:opacity-100"
      >
        {'{}'}
      </DialogTrigger>
      <DialogContent size="default" class="ui-io-chat-json-dialog flex max-w-(--container-dialog-default) flex-col">
        <DialogHeader>
          <DialogTitle class="text-12">
            Message #{props.index} · {props.message.role}
          </DialogTitle>
          <DialogDescription class="text-11">Raw message payload</DialogDescription>
        </DialogHeader>
        <div class="ui-scrollbar min-h-0 flex-1 overflow-auto rounded-4 border border-border-subtle bg-surface-sunken p-12">
          <pre class="whitespace-pre-wrap break-words font-mono text-11 leading-16">{json()}</pre>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant={copied() ? 'primary' : 'secondary'}
            size="sm"
            onClick={handleCopy}
          >
            <Show when={copied()} fallback={<><Copy size={14} aria-hidden="true" /> Copy JSON</>}>
              <><Check size={14} aria-hidden="true" /> Copied</>
            </Show>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type ChatIoMessageBubbleProps = {
  message: ChatMessage;
  index: number;
  toolResults: Map<string, string>;
};

const ChatIoMessageBubble: Component<ChatIoMessageBubbleProps> = (props) => {
  const cfg = () => chatIoRoleConfig(props.message.role);
  const parts = createMemo(() => {
    const raw = extractParts(props.message.content, props.message.toolCalls);
    if (props.message.role === 'assistant') {
      return enrichPartsWithToolResults(raw, props.toolResults);
    }
    return raw;
  });
  const RoleIcon = () => {
    const Icon = cfg().icon;
    return <Icon size={14} aria-hidden="true" />;
  };

  const label = () => cfg().label || props.message.role;
  const nameSuffix = () => (props.message.name ? ` · ${props.message.name}` : '');
  const toolSuffix = () => (
    props.message.toolCallId ? ` · ${props.message.toolCallId.slice(0, 12)}…` : ''
  );

  return (
    <div class={cn('group flex gap-10', cfg().alignRight && 'flex-row-reverse')}>
      <div
        class={cn(
          'mt-2 flex h-24 w-24 shrink-0 items-center justify-center rounded-4',
          cfg().iconClass,
        )}
      >
        <RoleIcon />
      </div>

      <div class={cn('ui-io-chat-bubble-column min-w-0 flex-1', cfg().alignRight && 'flex flex-col items-end')}>
        <div
          class={cn(
            'mb-2 flex items-center gap-6 text-11 text-content-muted',
            cfg().alignRight && 'flex-row-reverse',
          )}
        >
          <span class="font-600 uppercase tracking-wide">{label()}</span>
          <Show when={props.message.name || props.message.toolCallId}>
            <span class="truncate font-mono text-10 opacity-70">
              {nameSuffix()}{toolSuffix()}
            </span>
          </Show>
          <span class="font-mono text-10 opacity-50">#{props.index}</span>
          <ChatIoMessageJsonDialog message={props.message} index={props.index} />
        </div>

        <div class={cn('rounded-8 border px-12 py-8', cfg().roleClass)}>
          <Show
            when={parts().length > 0}
            fallback={<span class="text-11 italic text-content-muted">(empty)</span>}
          >
            <div class="flex flex-col gap-6">
              <For each={parts()}>
                {(part) => <ChatIoPartView part={part} mono={cfg().mono} />}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export type ChatIoListProps = {
  messages: ChatMessage[];
  class?: string;
  'data-testid'?: string;
};

/** Chat 形态 IO 列表：role 气泡、渐进加载，对齐 peri-fuse ChatViewer。 */
export const ChatIoList: Component<ChatIoListProps> = (props) => {
  const [visibleCount, setVisibleCount] = createSignal(
    Math.min(INITIAL_VISIBLE, prepareChatIoMessages(props.messages).messages.length),
  );

  const prepared = createMemo(() => prepareChatIoMessages(props.messages));
  const visible = createMemo(() => {
    const { messages } = prepared();
    return messages.slice(messages.length - visibleCount());
  });
  const visibleStartIndex = createMemo(() => prepared().messages.length - visibleCount());
  const toolResults = () => prepared().toolResults;
  const hiddenCount = () => prepared().messages.length - visibleCount();

  const loadEarlier = () => {
    setVisibleCount((count) => Math.min(count + LOAD_STEP, prepared().messages.length));
  };

  return (
    <div
      data-testid={props['data-testid'] ?? 'chat-io-list'}
      class={cn('ui-io-chat-list rounded-4 border border-border-subtle bg-surface-sunken', props.class)}
    >
      <div class="flex items-center justify-between border-b border-border-subtle px-12 py-8">
        <span class="text-11 font-500 text-content-muted">
          {prepared().messages.length} messages
        </span>
        <Show when={hiddenCount() > 0}>
          <span class="text-10 text-content-muted">
            showing latest {visibleCount()}
          </span>
        </Show>
      </div>

      <div class="flex flex-col gap-12 p-12">
        <Show when={hiddenCount() > 0}>
          <button
            type="button"
            onClick={loadEarlier}
            class="flex w-full items-center justify-center gap-6 rounded-4 border border-dashed border-border-subtle py-8 text-11 font-500 text-content-muted transition-colors hover:border-solid hover:bg-surface-hover hover:text-content-primary"
          >
            <History size={14} aria-hidden="true" />
            Load {Math.min(LOAD_STEP, hiddenCount())} earlier messages
            <span class="text-10 opacity-60">({hiddenCount()} hidden)</span>
          </button>
        </Show>

        <For each={visible()}>
          {(message, index) => (
            <ChatIoMessageBubble
              message={message}
              index={visibleStartIndex() + index() + 1}
              toolResults={toolResults()}
            />
          )}
        </For>
      </div>
    </div>
  );
};
