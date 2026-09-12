import {
  HistoryBoundary,
  ToolActivityGroup,
  ToolActivityRow,
  TranscriptRowShell,
  UserBubble,
} from '@peri/ui';
import { FilePen, Search, Terminal } from 'lucide-solid';

/** Tier 4 · Chat transcript 组合：assistant 文流 + 工具活动组。 */
export function ChatTranscriptLayout() {
  const noopMeasure = () => {};

  return (
    <div class="flex w-full flex-col gap-16" role="list" aria-label="Conversation transcript">
      <TranscriptRowShell id="catalog-user-1" position={1} size={4} onMeasure={noopMeasure}>
        <UserBubble>
          Check the build entry first, then constrain the fix to the browser adapter.
        </UserBubble>
      </TranscriptRowShell>
      <HistoryBoundary kind="verified_history" />
      <TranscriptRowShell id="catalog-assistant-1" position={2} size={4} onMeasure={noopMeasure}>
        <div class="text-13 leading-normal text-content-primary">
          The failure comes from a browser-only import crossing the build boundary. I isolated the import and verified the production bundle.
        </div>
      </TranscriptRowShell>
      <TranscriptRowShell id="catalog-tools-1" position={3} size={4} onMeasure={noopMeasure}>
        <div class="my-1 mb-4">
          <ToolActivityGroup>
            <ToolActivityRow icon={Search} title={'Searched "runtime binding"'} subtitle="in server/src · 3 matches" input="server/src" output="3 matches" status="done" duration="84ms" />
            <ToolActivityRow icon={FilePen} title="Edited store.ts" subtitle="1 change" input="web/src/panel/store.ts" status="done" duration="42ms" />
            <ToolActivityRow icon={Terminal} title="Running $ bun run test" input="bun run test" status="running" />
          </ToolActivityGroup>
        </div>
      </TranscriptRowShell>
      <HistoryBoundary kind="live_runtime" />
      <TranscriptRowShell id="catalog-assistant-2" position={4} size={4} onMeasure={noopMeasure}>
        <div class="text-13 leading-normal text-content-primary">
          Next I will run the browser contract suite and confirm the adapter stays behind the build boundary.
        </div>
      </TranscriptRowShell>
    </div>
  );
}
