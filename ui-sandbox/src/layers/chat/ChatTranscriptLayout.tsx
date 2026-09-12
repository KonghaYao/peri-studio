import { FilePen, Search, Terminal } from 'lucide-solid';
import { ToolActivityGroup, ToolActivityRow, TranscriptReasoning } from '@peri/ui';

/** Tier 4 · Chat transcript 组合：assistant 文流 + 工具活动组。 */
export function ChatTranscriptLayout() {
  return (
    <div class="flex w-full flex-col gap-16">
      <div class="flex justify-end">
        <div class="max-w-(--chat-bubble-max) rounded-xl border-x border-b border-border-subtle bg-surface-overlay px-12 py-8 text-13 leading-normal text-content-primary">
          Check the build entry first, then constrain the fix to the browser adapter.
        </div>
      </div>
      <div class="text-13 leading-normal text-content-primary">
        The failure comes from a browser-only import crossing the build boundary. I isolated the import and verified the production bundle.
      </div>
      <div class="my-1 mb-4">
        <ToolActivityGroup>
          <ToolActivityRow icon={Search} title={'Searched "runtime binding"'} subtitle="in server/src · 3 matches" input="server/src" output="3 matches" status="done" duration="84ms" />
          <TranscriptReasoning variant="activity">
            I found the browser boundary and will update only the affected adapter.
          </TranscriptReasoning>
          <TranscriptReasoning variant="activity" streaming>{' '}</TranscriptReasoning>
          <ToolActivityRow icon={FilePen} title="Edited store.ts" subtitle="1 change" input="web/src/panel/store.ts" status="done" duration="42ms" />
          <ToolActivityRow icon={Terminal} title="Running $ bun run test" input="bun run test" status="running" />
        </ToolActivityGroup>
      </div>
    </div>
  );
}
