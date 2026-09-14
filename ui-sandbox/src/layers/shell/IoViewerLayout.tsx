import { IoViewer } from '@peri/ui';
import { DemoRow } from '@/pages/shared/DemoSection';

const CHAT_DEMO = {
  messages: [
    { role: 'system', content: 'You are a concise assistant for trace inspection.' },
    { role: 'developer', content: 'Prefer structured JSON when explaining schemas.' },
    { role: 'user', content: 'Summarize the trace input format.' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Check OpenAI vs Anthropic message shapes.' },
        { type: 'text', text: 'Use `{ messages: [...] }` or a bare message array.' },
        {
          type: 'tool_use',
          id: 'tu_schema',
          name: 'read_schema',
          input: { path: 'docs/trace-io.md' },
        },
      ],
      tool_calls: [{
        id: 'tc_read',
        type: 'function',
        function: { name: 'grep', arguments: '{"pattern":"messages"}' },
      }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_schema', content: '{"ok":true}' }],
    },
    {
      role: 'tool',
      name: 'grep',
      tool_call_id: 'tc_read_0123456789ab',
      content: 'packages/web/src/shared/components/chat-utils.ts:36',
    },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Both wrapped and bare arrays are supported.' },
        { type: 'image_url', image_url: { url: 'https://placehold.co/120x80/png' } },
      ],
    },
  ],
};

const JSON_DEMO = {
  model: 'gpt-4.1-mini',
  temperature: 0.2,
  metadata: { source: 'sandbox', tags: ['demo', 'io-viewer'] },
};

const LONG_CHAT_DEMO = {
  messages: Array.from({ length: 24 }, (_, index) => ({
    role: index % 3 === 0 ? 'user' : 'assistant',
    content: `Synthetic message #${index + 1} for load-earlier behavior.`,
  })),
};

/** T4 · IoViewer demo：默认自绘 fuse 等价 Chat / JSON 检视。 */
export function IoViewerLayout() {
  return (
    <div class="flex flex-col gap-24">
      <DemoRow>
        <div class="flex w-full max-w-(--container-dialog-default) flex-col gap-8">
          <p class="text-11 text-content-muted">
            Chat-shaped trace IO: system, thinking, tool args/results, and long text render fully
            expanded (no in-viewer collapse). Tool results appear inside the matching assistant tool
            call (read_schema / grep), not as separate tool bubbles. Chat ⇄ JSON toggle included.
          </p>
          <IoViewer data={CHAT_DEMO} />
        </div>
      </DemoRow>

      <DemoRow>
        <div class="flex w-full max-w-(--container-dialog-default) flex-col gap-8">
          <p class="text-11 text-content-muted">
            Long conversations load the latest 20 messages first; use the dashed control to
            reveal earlier rows.
          </p>
          <IoViewer data={LONG_CHAT_DEMO} />
        </div>
      </DemoRow>

      <DemoRow>
        <div class="flex w-full max-w-(--container-dialog-default) flex-col gap-8">
          <p class="text-11 text-content-muted">
            Non-chat JSON skips the segmented control and renders JsonTree directly.
          </p>
          <IoViewer data={JSON_DEMO} />
        </div>
      </DemoRow>

      <DemoRow>
        <div class="flex w-full max-w-(--container-dialog-default) flex-col gap-8">
          <p class="text-11 text-content-muted">Empty and unparseable values stay in JSON mode.</p>
          <div class="grid grid-cols-2 gap-12">
            <IoViewer data={null} />
            <IoViewer data="plain-text-output" />
          </div>
        </div>
      </DemoRow>
    </div>
  );
}
