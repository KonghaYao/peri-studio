import { ChatHeader } from '@/components/blocks/chrome';
import { ChatTranscriptLayout } from './ChatTranscriptLayout';

/** Tier 4 · Chat 工作区：顶栏标题 + 消息流（不含 Composer）。 */
export function ChatShellLayout() {
  return (
    <div class="flex h-(--workbench-frame-height) min-h-96 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-canvas">
      <ChatHeader title="Refactor ACP session recovery and projection boundaries" />
      <div class="ui-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ChatTranscriptLayout />
      </div>
    </div>
  );
}
