import { Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import { UserBubble } from '@/components/blocks';
import { ChatTranscriptLayout } from '@/layers/chat/ChatTranscriptLayout';
import {
  Avatar,
  AvatarFallback,
  Conversation,
  ConversationContent,
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
  Spinner,
} from '@peri/ui';
import { CatalogDemo } from '@/pages/shared/DemoSection';

export function ComponentCatalogExtrasF(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'conversation')}>
      <CatalogDemo
        id="conversation"
        title="Conversation"
        description="MessageScroller 滚动容器；Transcript 正文复用 Blocks UserBubble 与 AI Tool activity（见 #/blocks、#/components-ai）。"
      >
        <div class="relative h-320 overflow-hidden rounded-8 border border-border-subtle">
          <Conversation autoScroll defaultScrollPosition="end" class="h-full">
            <ConversationContent class="gap-16 px-16 py-16">
              <MessageScrollerItem messageId="transcript" scrollAnchor>
                <ChatTranscriptLayout />
              </MessageScrollerItem>
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'message')}>
      <CatalogDemo
        id="message"
        title="Message branches"
        description="T2 行布局与分支切换；用户气泡用 Blocks UserBubble，助手为无气泡文流。"
      >
        <Message align="end">
          <MessageAvatar>
            <Avatar class="size-32"><AvatarFallback>U</AvatarFallback></Avatar>
          </MessageAvatar>
          <MessageContent>
            <UserBubble>How does session recovery work?</UserBubble>
          </MessageContent>
        </Message>
        <Message from="assistant" class="mt-12">
          <MessageAvatar>
            <Avatar class="size-32"><AvatarFallback>A</AvatarFallback></Avatar>
          </MessageAvatar>
          <MessageContent>
            <MessageBranch defaultBranch={0}>
              <MessageBranchContent>
                <p class="m-0 text-13 leading-normal text-content-primary">Server restarts clear runtime; chat/load rebuilds from ACP.</p>
                <p class="m-0 text-13 leading-normal text-content-primary">Alternate answer: use session/load with exact ACP session id.</p>
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

      <Show when={showCatalogSection(props.sections, 'marker')}>
      <CatalogDemo id="marker" title="Marker" description="会话内状态行与分隔线。">
        <div class="flex flex-col gap-12">
          <Marker>
            <MarkerIcon><Spinner class="size-16" /></MarkerIcon>
            <MarkerContent><span class="text-12 text-content-muted">Thinking</span></MarkerContent>
          </Marker>
          <Marker variant="separator">Today</Marker>
          <Marker variant="border">
            <MarkerContent>Switched to branch <strong>main</strong></MarkerContent>
          </Marker>
        </div>
      </CatalogDemo>
      </Show>
    </>
  );
}
