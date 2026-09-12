import { ChatHeader, ChatWorkspaceShell } from '@peri/ui';
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
        <div class="ui-chat-workspace__transcript ui-scrollbar ui-chat-workspace__transcript-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-16">
          <div class="ui-chat-column">
            <ChatTranscriptLayout />
          </div>
        </div>
      )}
    />
  );
}
