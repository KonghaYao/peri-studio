import { Braces, MessageSquareText } from 'lucide-solid';
import {
  createEffect,
  createMemo,
  createSignal,
  Show,
  splitProps,
  type Component,
  type JSX,
} from 'solid-js';
import {
  extractMessages,
  isChatPayload,
  parseMaybeString,
  type ChatMessage,
} from '../lib/chat-payload';
import { asAccessor, type MaybeAccessor } from '../lib/maybe-accessor';
import { cn } from '../lib/cn';
import { Segmented } from './segmented';
import { ChatIoList } from './io-viewer/ChatIoList';
import { IoViewerJsonView } from './io-viewer/IoViewerJsonView';

export type IoViewerViewMode = 'chat' | 'json';

export type IoViewerChatRenderContext = {
  messages: ChatMessage[];
  parsed: unknown;
  raw: unknown;
};

export type IoViewerJsonRenderContext = {
  data: unknown;
  parsed: unknown;
};

export type IoViewerShellProps = {
  data: MaybeAccessor<unknown>;
  defaultMode?: IoViewerViewMode;
  class?: string;
  /** 可选覆盖默认 ChatIoList 自绘。 */
  renderChat?: (context: IoViewerChatRenderContext) => JSX.Element;
  /** 可选覆盖默认 IoViewerJsonView。 */
  renderJson?: (context: IoViewerJsonRenderContext) => JSX.Element;
  onModeChange?: (mode: IoViewerViewMode) => void;
  'data-testid'?: string;
};

function resolveInitialMode(
  isChat: boolean,
  defaultMode?: IoViewerViewMode,
): IoViewerViewMode {
  if (defaultMode) return defaultMode;
  return isChat ? 'chat' : 'json';
}

/** T3 · trace/observation IO 检视：默认自绘 Chat ⇄ JSON，slot 仅作可选增强。 */
export const IoViewerShell: Component<IoViewerShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'data',
    'defaultMode',
    'class',
    'renderChat',
    'renderJson',
    'onModeChange',
  ]);

  const rawData = () => asAccessor(local.data)();
  const parsed = createMemo(() => parseMaybeString(rawData()));
  const isChat = createMemo(() => isChatPayload(parsed()));
  const messages = createMemo(() => (isChat() ? extractMessages(parsed()) : null));
  const usesSlots = () => Boolean(local.renderChat || local.renderJson);

  const [mode, setMode] = createSignal<IoViewerViewMode>(
    resolveInitialMode(isChat(), local.defaultMode),
  );

  createEffect(() => {
    if (!isChat()) {
      setMode('json');
    }
  });

  const handleModeChange = (next: IoViewerViewMode) => {
    setMode(next);
    local.onModeChange?.(next);
  };

  const chatContext = (): IoViewerChatRenderContext => ({
    messages: messages() ?? [],
    parsed: parsed(),
    raw: rawData(),
  });

  const jsonContext = (): IoViewerJsonRenderContext => ({
    data: rawData(),
    parsed: parsed(),
  });

  const showChat = () => isChat() && messages() && mode() === 'chat';

  const renderDefaultChat = () => (
    <ChatIoList messages={messages() ?? []} />
  );

  const jsonViewData = () => {
    // fuse：chat 形态 JSON tab 用原始 data；非 chat 用 parse 后的值。
    if (isChat() && messages()) return rawData();
    return parsed();
  };

  const renderDefaultJson = () => (
    <IoViewerJsonView data={jsonViewData()} />
  );

  const renderChatContent = () => {
    if (local.renderChat) return local.renderChat(chatContext());
    return renderDefaultChat();
  };

  const renderJsonContent = () => {
    if (local.renderJson) return local.renderJson(jsonContext());
    return renderDefaultJson();
  };

  const bodyContent = () => (
    <Show when={showChat()} fallback={renderJsonContent()}>
      {renderChatContent()}
    </Show>
  );

  return (
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'io-viewer-shell'}
      class={cn('ui-io-viewer-shell flex min-h-0 flex-col gap-8', local.class)}
    >
      <Show when={isChat() && messages()}>
        <div class="ui-io-viewer-toolbar flex w-fit max-w-full shrink-0 items-center self-start">
          <Segmented<IoViewerViewMode>
            class="ui-io-viewer-mode-toggle"
            size="sm"
            value={mode()}
            onChange={handleModeChange}
            aria-label="View mode"
            options={[
              {
                value: 'chat',
                label: 'Chat',
                icon: <MessageSquareText size={12} aria-hidden="true" />,
              },
              {
                value: 'json',
                label: 'JSON',
                icon: <Braces size={12} aria-hidden="true" />,
              },
            ]}
          />
        </div>
      </Show>

      <Show
        when={usesSlots()}
        fallback={(
          <div
            class="ui-io-viewer-body-default ui-scrollbar min-h-0 max-h-(--container-io-viewer-max) flex-1 overflow-auto"
            data-view-mode={showChat() ? 'chat' : 'json'}
          >
            {bodyContent()}
          </div>
        )}
      >
        <div
          class="ui-io-viewer-body ui-scrollbar min-h-0 flex-1"
          data-view-mode={showChat() ? 'chat' : 'json'}
        >
          {bodyContent()}
        </div>
      </Show>
    </div>
  );
};

/** fuse 同名入口：`<IoViewer data={unknown} />` 默认可用。 */
export const IoViewer = IoViewerShell;
