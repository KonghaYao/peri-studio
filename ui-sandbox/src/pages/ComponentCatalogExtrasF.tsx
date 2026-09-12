import { createSignal, For, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  Attachment,
  AttachmentEmpty,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  Avatar,
  AvatarFallback,
  Bubble,
  BubbleContent,
  Button,
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtImage,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationScrollButton,
  Marker,
  MarkerContent,
  MarkerIcon,
  Message,
  MessageAction,
  MessageActions,
  MessageAvatar,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageScrollerItem,
  MessageToolbar,
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Spinner,
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type AttachmentData,
  type ChatStatus,
} from '@peri/ui';
import { createPulseStream, createStreamingReveal, StreamingControls } from '@/lib/streaming-demo';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

const REASONING_SAMPLE =
  'Checking architecture.md for session/load semantics and gap recovery rules…';

const demoMessages = [
  { id: '1', role: 'user', text: 'Summarize the architecture doc.' },
  { id: '2', role: 'assistant', text: 'Peri Studio uses a server control plane and instance runtime over WebSocket.' },
  { id: '3', role: 'assistant', text: 'Web consumes Yjs read-only projections — no forged history in the browser.' },
];

const attachmentFiles: AttachmentData[] = [
  { id: 'a1', name: 'architecture.md', size: 48_200, mediaType: 'text/markdown' },
  { id: 'a2', name: 'diagram.png', size: 128_000, mediaType: 'image/png', progress: 62 },
];

export function ComponentCatalogExtrasF(props: { sections?: string[] }) {
  const reasoningReveal = createStreamingReveal(REASONING_SAMPLE);
  const markerThinking = createPulseStream(2800);
  const [chatStatus, setChatStatus] = createSignal<ChatStatus>('ready');

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'scroll-utils')}>
      <CatalogDemo id="scroll-utils" title="scroll-fade · shimmer" description="CSS utilities（见 packages/ui utilities.css）。">
        <DemoRow label="shimmer">
          <span class="shimmer text-13 font-medium text-content-secondary">Thinking…</span>
        </DemoRow>
        <div class="max-h-120 overflow-y-auto scroll-fade rounded-8 border border-border-subtle p-12">
          <For each={Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: scroll-fade hints at more content above.`)}>
            {(line) => <p class="py-4 text-12 text-content-muted">{line}</p>}
          </For>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'marker')}>
      <CatalogDemo id="marker" title="Marker" description="会话内状态行、分隔线与 thinking 标记。">
        <div class="flex flex-col gap-12">
          <StreamingControls
            playing={markerThinking.playing()}
            complete={markerThinking.complete()}
            onPlay={markerThinking.play}
            onReset={markerThinking.reset}
            playLabel="Play thinking"
          />
          <Marker>
            <MarkerIcon><Spinner class="size-16" /></MarkerIcon>
            <MarkerContent>
              <span class={`text-12 ${markerThinking.active() ? 'shimmer' : 'text-content-muted'}`}>Thinking</span>
            </MarkerContent>
          </Marker>
          <Marker variant="separator">Today</Marker>
          <Marker variant="border">
            <MarkerContent>Switched to branch <strong>main</strong></MarkerContent>
          </Marker>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'bubble')}>
      <CatalogDemo id="bubble" title="Bubble" description="消息气泡面：变体与对齐。">
        <div class="flex flex-col gap-12">
          <Bubble variant="primary" align="end">
            <BubbleContent>User message on the end side.</BubbleContent>
          </Bubble>
          <Bubble variant="muted" align="start">
            <BubbleContent>Assistant reply on the start side.</BubbleContent>
          </Bubble>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'message')}>
      <CatalogDemo id="message" title="Message" description="行布局：avatar + bubble + branches/actions。">
        <Message align="end">
          <MessageAvatar>
            <Avatar class="size-32"><AvatarFallback>U</AvatarFallback></Avatar>
          </MessageAvatar>
          <MessageContent>
            <Bubble variant="primary" align="end">
              <BubbleContent>How does session recovery work?</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
        <Message from="assistant" class="mt-12">
          <MessageAvatar>
            <Avatar class="size-32"><AvatarFallback>A</AvatarFallback></Avatar>
          </MessageAvatar>
          <MessageContent>
            <MessageBranch defaultBranch={0}>
              <MessageBranchContent>
                <Bubble variant="muted" align="start">
                  <BubbleContent>Server restarts clear runtime; chat/load rebuilds from ACP.</BubbleContent>
                </Bubble>
                <Bubble variant="muted" align="start">
                  <BubbleContent>Alternate answer: use session/load with exact ACP session id.</BubbleContent>
                </Bubble>
              </MessageBranchContent>
              <MessageToolbar>
                <MessageBranchSelector>
                  <MessageBranchPrevious />
                  <MessageBranchPage />
                  <MessageBranchNext />
                </MessageBranchSelector>
                <MessageActions>
                  <MessageAction tooltip="Copy" label="Copy">Copy</MessageAction>
                </MessageActions>
              </MessageToolbar>
            </MessageBranch>
          </MessageContent>
        </Message>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'conversation')}>
      <CatalogDemo id="conversation" title="Conversation" description="MessageScroller 会话容器。">
        <div class="relative h-240 overflow-hidden rounded-8 border border-border-subtle">
          <Conversation autoScroll defaultScrollPosition="end" class="h-full">
            <ConversationDownload messages={demoMessages.map((m) => ({ role: m.role, content: m.text }))} />
            <ConversationContent class="gap-12">
              <For each={demoMessages}>
                {(m) => (
                  <MessageScrollerItem messageId={m.id} scrollAnchor={m.role === 'user'}>
                    <Message align={m.role === 'user' ? 'end' : 'start'}>
                      <MessageContent>
                        <Bubble variant={m.role === 'user' ? 'primary' : 'muted'} align={m.role === 'user' ? 'end' : 'start'}>
                          <BubbleContent>{m.text}</BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )}
              </For>
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'reasoning')}>
      <CatalogDemo id="reasoning" title="Reasoning" description="可折叠推理块；Play stream 触发 Thinking 扫光并逐字揭示。">
        <StreamingControls
          playing={reasoningReveal.playing()}
          complete={reasoningReveal.complete()}
          onPlay={reasoningReveal.play}
          onReset={reasoningReveal.reset}
        />
        <Reasoning isStreaming={reasoningReveal.streaming()} defaultOpen>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningReveal.text()}</ReasoningContent>
        </Reasoning>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'tool')}>
      <CatalogDemo id="tool" title="Tool" description="工具调用生命周期卡片。">
        <div class="flex max-w-md flex-col gap-12">
          <Tool state="input-streaming" defaultOpen>
            <ToolHeader type="tool-grep" state="input-streaming" />
            <ToolContent>
              <ToolInput input={{ pattern: 'session/load' }} />
            </ToolContent>
          </Tool>
          <Tool state="output-available" defaultOpen>
            <ToolHeader title="Read" state="output-available" />
            <ToolContent>
              <ToolInput input={{ file_path: 'docs/architecture.md' }} />
              <ToolOutput output="Architecture v2.14 — server control plane…" />
            </ToolContent>
          </Tool>
          <Tool state="output-error" defaultOpen>
            <ToolHeader type="dynamic-tool" toolName="fetch_url" state="output-error" />
            <ToolContent>
              <ToolOutput errorText="Upstream timeout after 30s" />
            </ToolContent>
          </Tool>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'chain-of-thought')}>
      <CatalogDemo id="chain-of-thought" title="Chain of thought" description="分步思考链。">
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>Research plan</ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep status="complete" label="Scan docs/architecture.md" />
            <ChainOfThoughtStep status="active" label="Compare with terminology.md">
              <ChainOfThoughtSearchResults>
                <ChainOfThoughtSearchResult>terminology.md</ChainOfThoughtSearchResult>
                <ChainOfThoughtSearchResult>architecture.md</ChainOfThoughtSearchResult>
              </ChainOfThoughtSearchResults>
            </ChainOfThoughtStep>
            <ChainOfThoughtStep status="pending" label="Draft summary" />
            <ChainOfThoughtImage caption="Topology sketch">
              <div class="flex h-120 w-full items-center justify-center text-12 text-content-muted">
                Image placeholder
              </div>
            </ChainOfThoughtImage>
          </ChainOfThoughtContent>
        </ChainOfThought>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'prompt-input')}>
      <CatalogDemo id="prompt-input" title="Prompt input" description="Composer 输入区：附件、操作菜单与 ChatStatus 提交态。">
        <PromptInput
          class="max-w-md"
          accept="image/*,.md,.txt"
          multiple
          onSubmit={() => {
            setChatStatus('submitted');
            window.setTimeout(() => setChatStatus('streaming'), 600);
          }}
        >
          <PromptInputHeader>
            <Attachments variant="inline">
              <For each={attachmentFiles.slice(0, 1)}>
                {(file) => (
                  <Attachment data={file} onRemove={() => undefined}>
                    <AttachmentPreview />
                    <AttachmentInfo />
                    <AttachmentRemove />
                  </Attachment>
                )}
              </For>
            </Attachments>
          </PromptInputHeader>
          <PromptInputTextarea aria-label="Message" placeholder="What would you like to know?" />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="Add" />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            </PromptInputTools>
            <PromptInputSubmit
              status={chatStatus()}
              onStop={() => setChatStatus('ready')}
            />
          </PromptInputFooter>
        </PromptInput>
        <div class="mt-8 flex flex-wrap gap-8">
          <Button size="sm" variant="ghost" onClick={() => setChatStatus('ready')}>Ready</Button>
          <Button size="sm" variant="ghost" onClick={() => setChatStatus('submitted')}>Submitted</Button>
          <Button size="sm" variant="ghost" onClick={() => setChatStatus('streaming')}>Streaming</Button>
          <Button size="sm" variant="ghost" onClick={() => setChatStatus('error')}>Error</Button>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'attachments')}>
      <CatalogDemo id="attachments" title="Attachments" description="grid / inline / list 变体与悬停预览。">
        <div class="flex max-w-md flex-col gap-16">
          <Attachments variant="grid">
            <Attachment
              data={{ ...attachmentFiles[1], url: 'https://picsum.photos/seed/peri/96/96' }}
              onRemove={() => undefined}
            >
              <AttachmentHoverCard>
                <AttachmentHoverCardTrigger>
                  <AttachmentPreview />
                </AttachmentHoverCardTrigger>
                <AttachmentHoverCardContent>
                  <img
                    src="https://picsum.photos/seed/peri/240/160"
                    alt="diagram.png preview"
                    class="max-h-160 rounded-6"
                  />
                </AttachmentHoverCardContent>
              </AttachmentHoverCard>
              <AttachmentRemove />
            </Attachment>
          </Attachments>
          <Attachments variant="inline">
            <Attachment data={attachmentFiles[0]} onRemove={() => undefined}>
              <AttachmentPreview />
              <AttachmentInfo />
              <AttachmentRemove />
            </Attachment>
          </Attachments>
          <Attachments variant="list">
            <For each={attachmentFiles}>
              {(file) => (
                <Attachment data={file} onRemove={() => undefined}>
                  <AttachmentPreview />
                  <AttachmentInfo showMediaType />
                  <AttachmentRemove />
                </Attachment>
              )}
            </For>
          </Attachments>
          <AttachmentEmpty />
        </div>
      </CatalogDemo>
      </Show>
    </>
  );
}
