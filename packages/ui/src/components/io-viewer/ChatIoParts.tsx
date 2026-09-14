import { Sparkles, SquareTerminal } from 'lucide-solid';
import { createMemo, Show, type Component } from 'solid-js';
import type { DisplayContentPart, ToolUsePartWithResult } from '../../lib/chat-io-tool-pairing';
import { cn } from '../../lib/cn';

export type ChatIoMessageBodyProps = {
  text: string;
  mono?: boolean;
};

/** 正文展示；外层滚动容器负责溢出。 */
export const ChatIoMessageBody: Component<ChatIoMessageBodyProps> = (props) => (
  <pre
    class={cn(
      'w-full whitespace-pre-wrap break-words text-11 leading-16 text-content-primary',
      props.mono ? 'font-mono text-content-secondary' : 'font-sans',
    )}
  >
    {props.text}
  </pre>
);

const ChatIoThinkingBlock: Component<{ text: string }> = (props) => (
  <div class="ui-io-chat-thinking rounded-4 border">
    <div class="flex items-center gap-6 border-b px-8 py-4">
      <Sparkles size={12} class="text-accent-solid" aria-hidden="true" />
      <span class="text-10 font-600 uppercase tracking-wide text-accent-solid">thinking</span>
    </div>
    <div class="px-8 py-6">
      <ChatIoMessageBody text={props.text} />
    </div>
  </div>
);

const ChatIoToolUseBlock: Component<{
  id?: string;
  name: string;
  input: unknown;
  result?: string;
}> = (props) => {
  const json = createMemo(() => (
    typeof props.input === 'string' ? props.input : JSON.stringify(props.input ?? {}, null, 2)
  ));

  return (
    <div class="ui-io-chat-tool-use rounded-4 border" data-tool-call-id={props.id}>
      <div class="flex items-center gap-6 border-b px-8 py-4">
        <SquareTerminal size={12} class="text-feedback-success-strong" aria-hidden="true" />
        <span class="font-mono text-11 font-500 text-feedback-success-strong">{props.name}</span>
        <Show when={props.id}>
          <span class="truncate font-mono text-10 opacity-50">{props.id}</span>
        </Show>
        <Show when={props.result}>
          <span class="text-10 text-content-muted">· result</span>
        </Show>
      </div>
      <pre class="ui-io-chat-tool-use-body ui-scrollbar max-h-(--container-io-viewer-tool-args-max) overflow-auto whitespace-pre-wrap break-words px-8 py-6 font-mono text-11 leading-16 text-content-secondary">
        {json()}
      </pre>
      <Show when={props.result}>
        <div class="ui-io-chat-tool-result border-t px-8 py-6">
          <div class="mb-4 text-10 font-600 uppercase tracking-wide text-content-muted">
            Result
          </div>
          <ChatIoMessageBody text={props.result!} mono />
        </div>
      </Show>
    </div>
  );
};

const ChatIoToolResultBlock: Component<{ id?: string; text: string }> = (props) => (
  <div>
    <Show when={props.id}>
      <div class="mb-2 font-mono text-10 text-content-muted">↳ {props.id}</div>
    </Show>
    <ChatIoMessageBody text={props.text} mono />
  </div>
);

export type ChatIoPartViewProps = {
  part: DisplayContentPart;
  mono?: boolean;
};

function renderPart(part: DisplayContentPart, mono?: boolean) {
  switch (part.type) {
    case 'text':
      return part.text ? <ChatIoMessageBody text={part.text} mono={mono} /> : null;
    case 'thinking':
      return part.text ? <ChatIoThinkingBlock text={part.text} /> : null;
    case 'tool_use': {
      const toolPart = part as ToolUsePartWithResult;
      return (
        <ChatIoToolUseBlock
          id={toolPart.id}
          name={toolPart.name}
          input={toolPart.input}
          result={toolPart.result}
        />
      );
    }
    case 'tool_result':
      return part.text ? <ChatIoToolResultBlock id={part.id} text={part.text} /> : null;
    case 'image':
      return part.url ? (
        <img
          src={part.url}
          alt="message image"
          class="max-h-(--container-io-viewer-image-max) rounded-4 border border-border-subtle"
        />
      ) : (
        <span class="text-11 italic text-content-muted">[image]</span>
      );
    case 'audio':
      return <span class="text-11 italic text-content-muted">[audio]</span>;
    default:
      return <ChatIoMessageBody text={JSON.stringify(part.raw, null, 2)} mono />;
  }
}

/** 渲染单个归一化 content part。 */
export const ChatIoPartView: Component<ChatIoPartViewProps> = (props) => (
  <>{renderPart(props.part, props.mono)}</>
);
