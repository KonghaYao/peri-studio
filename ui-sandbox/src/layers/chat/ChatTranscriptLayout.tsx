import { UserBubble } from '@peri/ui';
import { FilePen, Search, Terminal } from 'lucide-solid';
import { ToolActivityGroup, ToolActivityRow } from '@peri/ui';

/** Tier 4 · Chat transcript 组合：assistant 文流 + 工具活动组。 */
export function ChatTranscriptLayout() {
  return (
    <div class="flex w-full flex-col gap-16">
      <UserBubble>
        Check the build entry first, then constrain the fix to the browser adapter.
      </UserBubble>
      <div class="text-13 leading-normal text-content-primary">
        The failure comes from a browser-only import crossing the build boundary. I isolated the import and verified the production bundle.
      </div>
      <div class="my-1 mb-4">
        <ToolActivityGroup>
          <ToolActivityRow icon={Search} title={'Searched "runtime binding"'} subtitle="in server/src · 3 matches" input="server/src" output="3 matches" status="done" duration="84ms" />
          <ToolActivityRow icon={FilePen} title="Edited store.ts" subtitle="1 change" input="web/src/panel/store.ts" status="done" duration="42ms" />
          <ToolActivityRow icon={Terminal} title="Running $ bun run test" input="bun run test" status="running" />
        </ToolActivityGroup>
      </div>
    </div>
  );
}
