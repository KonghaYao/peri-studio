import { createSignal, For } from 'solid-js';
import {
  Attachment,
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
  ChainOfThoughtStep,
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  Marker,
  MarkerContent,
  MarkerIcon,
  Message,
  MessageAvatar,
  MessageContent,
  MessageScrollerItem,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
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
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

const demoMessages = [
  { id: '1', role: 'user', text: 'Summarize the architecture doc.' },
  { id: '2', role: 'assistant', text: 'Peri Studio uses a server control plane and instance runtime over WebSocket.' },
  { id: '3', role: 'assistant', text: 'Web consumes Yjs read-only projections — no forged history in the browser.' },
];

const attachmentFiles: AttachmentData[] = [
  { id: 'a1', name: 'architecture.md', size: 48_200, mediaType: 'text/markdown' },
  { id: 'a2', name: 'diagram.png', size: 128_000, mediaType: 'image/png', progress: 62 },
];

export function ComponentCatalogExtrasF() {
  const [streaming, setStreaming] = createSignal(true);

  return (
    <>
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

      <CatalogDemo id="marker" title="Marker" description="会话内状态行、分隔线与 thinking 标记。">
        <div class="flex flex-col gap-8">
          <Marker>
            <MarkerIcon><Spinner class="size-16" /></MarkerIcon>
            <MarkerContent><span class="shimmer text-12">Thinking</span></MarkerContent>
          </Marker>
          <Marker variant="separator">Today</Marker>
          <Marker variant="border">
            <MarkerContent>Switched to branch <strong>main</strong></MarkerContent>
          </Marker>
        </div>
      </CatalogDemo>

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

      <CatalogDemo id="message" title="Message" description="行布局：avatar + bubble。">
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
        <Message align="start" class="mt-12">
          <MessageAvatar>
            <Avatar class="size-32"><AvatarFallback>A</AvatarFallback></Avatar>
          </MessageAvatar>
          <MessageContent>
            <Bubble variant="muted" align="start">
              <BubbleContent>Server restarts clear runtime; chat/load rebuilds from ACP.</BubbleContent>
            </Bubble>
          </MessageContent>
        </Message>
      </CatalogDemo>

      <CatalogDemo id="conversation" title="Conversation" description="MessageScroller 会话容器。">
        <div class="h-240 overflow-hidden rounded-8 border border-border-subtle">
          <Conversation autoScroll defaultScrollPosition="end" class="h-full">
            <ConversationContent class="gap-12 p-12">
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

      <CatalogDemo id="reasoning" title="Reasoning" description="可折叠推理块，流式时自动展开。">
        <Reasoning isStreaming={streaming()} defaultOpen>
          <ReasoningTrigger />
          <ReasoningContent>
            Checking architecture.md for session/load semantics and gap recovery rules…
          </ReasoningContent>
        </Reasoning>
        <Button size="sm" variant="ghost" class="mt-8" onClick={() => setStreaming((v) => !v)}>
          Toggle streaming
        </Button>
      </CatalogDemo>

      <CatalogDemo id="tool" title="Tool" description="工具调用生命周期卡片。">
        <Tool state="output-available" defaultOpen>
          <ToolHeader title="Read" state="output-available" />
          <ToolContent>
            <ToolInput input={{ file_path: 'docs/architecture.md' }} />
            <ToolOutput>Architecture v2.14 — server control plane…</ToolOutput>
          </ToolContent>
        </Tool>
      </CatalogDemo>

      <CatalogDemo id="chain-of-thought" title="Chain of thought" description="分步思考链。">
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>Research plan</ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep status="complete" label="Scan docs/architecture.md" />
            <ChainOfThoughtStep status="active" label="Compare with terminology.md" />
            <ChainOfThoughtStep status="pending" label="Draft summary" />
          </ChainOfThoughtContent>
        </ChainOfThought>
      </CatalogDemo>

      <CatalogDemo id="prompt-input" title="Prompt input" description="Composer 输入区。">
        <PromptInput class="max-w-md rounded-8 border border-border-subtle p-8" onSubmit={() => undefined}>
          <PromptInputTextarea aria-label="Message" placeholder="Message the agent…" />
          <PromptInputFooter>
            <PromptInputToolbar />
            <PromptInputSubmit />
          </PromptInputFooter>
        </PromptInput>
      </CatalogDemo>

      <CatalogDemo id="attachments" title="Attachments" description="附件列表与上传进度。">
        <Attachments variant="list" class="max-w-md">
          <For each={attachmentFiles}>
            {(file) => (
              <Attachment data={file} onRemove={() => undefined}>
                <AttachmentPreview />
                <AttachmentInfo />
                <AttachmentRemove />
              </Attachment>
            )}
          </For>
        </Attachments>
      </CatalogDemo>
    </>
  );
}
