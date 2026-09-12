import { ChatHeader, ChatWorkspaceShell, TranscriptViewportShell } from '@peri/ui';
import { ChatTranscriptLayout } from './ChatTranscriptLayout';

/** Tier 4 · Chat 工作区：消费 @peri/ui ChatWorkspaceShell（T3），mock 标题与消息流。 */
export function ChatShellLayout() {
  return (
    <ChatWorkspaceShell
      class="h-(--catalog-layer-chat-height) overflow-hidden rounded-lg border border-border-subtle bg-surface-canvas"
      header={(
        <ChatHeader title="Refactor ACP session recovery and projection boundaries" />
      )}
      transcript={(
        <TranscriptViewportShell aria-label="Conversation messages" class="min-h-0 flex-1">
          <div class="ui-chat-column py-16">
            <ChatTranscriptLayout />
          </div>
        </TranscriptViewportShell>
      )}
    />
  );
}
