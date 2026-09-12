import { Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import { ProjectRowAccessory, SessionRowAccessory, UserBubble, chatColumnClass } from '@peri/ui';
import { ChatHeader } from '@/components/blocks/chrome';
import { Folder } from 'lucide-solid';
import { ChatShellLayout, ChatTranscriptLayout } from '@/layers';
import {
  Avatar,
  AvatarFallback,
  Conversation,
  ConversationContent,
  ConversationScrollButton,
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
} from '@peri/ui';
import { CatalogDemo } from '@/pages/shared/DemoSection';

export function ComponentCatalogExtrasF(props: { sections?: string[] }) {
  return (
    <>
      <Show when={showCatalogSection(props.sections, 'conversation')}>
      <CatalogDemo
        id="conversation"
        title="Conversation"
        description="MessageScroller 滚动容器；Transcript 正文复用 UserBubble 与 AI Tool activity。"
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

      <Show when={showCatalogSection(props.sections, 'chat-shell')}>
      <CatalogDemo id="chat-shell" title="Chat shell">
        <ChatShellLayout />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'chat-transcript')}>
      <CatalogDemo id="chat-transcript" title="Chat transcript">
        <div class="max-h-(--catalog-layer-chat-height) overflow-auto rounded-lg border border-border-subtle bg-surface-canvas px-16 py-16">
          <div class={chatColumnClass}>
            <ChatTranscriptLayout />
          </div>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'chat-header')}>
      <CatalogDemo id="chat-header" title="Chat header">
        <div class="overflow-hidden rounded-lg border border-border-subtle">
          <ChatHeader title="Refactor ACP session recovery and projection boundaries" />
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'session-row-accessory')}>
      <CatalogDemo id="session-row-accessory" title="Session row accessory">
        <div class="max-w-sm rounded-lg border border-border-subtle bg-surface-overlay p-8">
          <div class="group/row relative min-h-36 rounded-md hover:bg-interaction-hover focus-within:bg-interaction-hover">
            <div class="flex min-h-36 items-center px-10">
              <span class="min-w-0 flex-1 truncate text-13 text-content-primary">Refactor ACP session recovery</span>
            </div>
            <SessionRowAccessory pinned actionsVisible />
          </div>
          <div class="group/row relative mt-4 min-h-36 rounded-md bg-sidebar-selected" data-selected="true">
            <div class="flex min-h-36 items-center px-10">
              <span class="min-w-0 flex-1 truncate text-13 text-content-primary">Design workspace state</span>
            </div>
            <SessionRowAccessory live />
          </div>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'project-row-accessory')}>
      <CatalogDemo id="project-row-accessory" title="Project row accessory">
        <div class="max-w-sm rounded-lg border border-border-subtle bg-surface-overlay p-8">
          <div class="group/workspace relative min-h-36 rounded-md hover:bg-interaction-hover">
            <div class="flex min-h-36 items-center gap-8 px-10">
              <Folder size={15} strokeWidth={1.7} class="shrink-0 text-content-muted" />
              <span class="min-w-0 flex-1 truncate text-13 text-content-primary">peri-studio</span>
            </div>
            <ProjectRowAccessory count={3} />
          </div>
        </div>
      </CatalogDemo>
      </Show>
    </>
  );
}
