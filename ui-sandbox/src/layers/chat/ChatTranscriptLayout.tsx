import { ToolActivityGroup, ToolActivityRow } from '@/components/blocks/chat';

/** Tier 4 · Chat transcript 组合：assistant 文流 + 工具活动组。 */
export function ChatTranscriptLayout() {
  return (
    <div class="flex max-w-(--chat-content-max) flex-col gap-4">
      <div class="flex justify-end">
        <div class="max-w-(--chat-bubble-max) rounded-xl border-x border-b border-border-subtle bg-surface-overlay px-3 py-2 text-13 leading-normal text-content-primary">
          Check the build entry first, then constrain the fix to the browser adapter.
        </div>
      </div>
      <div class="text-13 leading-normal text-content-primary">
        The failure comes from a browser-only import crossing the build boundary. I isolated the import and verified the production bundle.
      </div>
      <ToolActivityGroup>
        <ToolActivityRow name="Search runtime binding" input="server/src" output="3 matches" status="done" duration="84 ms" />
        <ToolActivityRow name="Update boundary" input="web/src/panel/store.ts" status="done" duration="42 ms" />
        <ToolActivityRow name="Run focused checks" input="bun run test" status="running" />
      </ToolActivityGroup>
    </div>
  );
}
