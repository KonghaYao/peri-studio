import { createSignal, For, Show } from 'solid-js';
import { FileText, FolderSearch, Terminal } from 'lucide-solid';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  Attachment,
  AttachmentEmpty,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  DataTable,
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationQuote,
  InlineCitationSource,
  InlineCitationText,
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanStep,
  PlanTitle,
  PlanTrigger,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ComposerQueue,
  Suggestion,
  SuggestionItem,
  ToolActivityGroup,
  ToolActivityRow,
  chatColumnClass,
  type AttachmentData,
} from '@peri/ui';
import { createPulseStream, StreamingControls } from '@/lib/streaming-demo';
import { QuestionnaireAskUserDemo } from '@/pages/demos/QuestionnaireAskUserDemo';
import { QuestionnaireOptionRowDemo } from '@/pages/demos/QuestionnaireOptionRowDemo';
import { CatalogDemo } from '@/pages/shared/DemoSection';

const attachmentFiles: AttachmentData[] = [
  { id: 'a1', name: 'architecture.md', size: 48_200, mediaType: 'text/markdown' },
  { id: 'a2', name: 'diagram.png', size: 128_000, mediaType: 'image/png', progress: 62 },
];

const tableRows = [
  { id: 'p1', name: 'peri-studio', sessions: 12, status: 'active' },
  { id: 'p2', name: 'docs-site', sessions: 3, status: 'archived' },
  { id: 'p3', name: 'ui-sandbox', sessions: 8, status: 'active' },
];

function ChatFrame(props: { children: unknown }) {
  return (
    <div class={`${chatColumnClass} rounded-lg border border-border-subtle bg-surface-overlay px-16 py-16`}>
      {props.children as never}
    </div>
  );
}

export function ComponentCatalogExtrasG(props: { sections?: string[] }) {
  const planStream = createPulseStream(3200);

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'suggestion')}>
      <CatalogDemo id="suggestion" title="Suggestion" description="Composer 底部快捷建议；横向滚动 chips。">
        <ChatFrame>
          <Suggestion>
            <SuggestionItem suggestion="Summarize this session" onClick={() => undefined} />
            <SuggestionItem suggestion="Write tests" onClick={() => undefined} />
            <SuggestionItem suggestion="Explain architecture" onClick={() => undefined} />
          </Suggestion>
        </ChatFrame>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'citation')}>
      <CatalogDemo id="citation" title="Inline citation" description="行内引用 hover 卡片与轮播来源。">
        <ChatFrame>
          <p class="text-13 text-content-primary">
            Session recovery uses explicit load
            <InlineCitation>
              <InlineCitationText>explicit session/load</InlineCitationText>
              <InlineCitationCard>
                <InlineCitationCardTrigger
                  sources={['https://example.com/architecture', 'https://example.com/terminology']}
                />
                <InlineCitationCardBody>
                  <InlineCitationCarousel>
                    <InlineCitationCarouselHeader>
                      <InlineCitationCarouselPrev />
                      <InlineCitationCarouselNext />
                      <InlineCitationCarouselIndex />
                    </InlineCitationCarouselHeader>
                    <InlineCitationCarouselContent>
                      <InlineCitationCarouselItem>
                        <InlineCitationSource
                          title="architecture.md"
                          url="https://example.com/architecture"
                          description="Server restart does not resurrect old runtime."
                        />
                      </InlineCitationCarouselItem>
                      <InlineCitationCarouselItem>
                        <InlineCitationQuote>
                          chat/load rebuilds the view per the control plane contract.
                        </InlineCitationQuote>
                      </InlineCitationCarouselItem>
                    </InlineCitationCarouselContent>
                  </InlineCitationCarousel>
                </InlineCitationCardBody>
              </InlineCitationCard>
            </InlineCitation>
            per the control plane contract.
          </p>
        </ChatFrame>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'plan')}>
      <CatalogDemo id="plan" title="Plan" description="决策面风格计划卡：线框边框 + 流式标题。">
        <div class="max-w-md flex flex-col gap-12">
          <StreamingControls
            playing={planStream.playing()}
            complete={planStream.complete()}
            onPlay={planStream.play}
            onReset={planStream.reset}
            playLabel="Play shimmer"
          />
          <Plan defaultOpen isStreaming={planStream.active()}>
            <PlanHeader>
              <div class="min-w-0 flex-1 space-y-4">
                <PlanTitle>Implementation plan</PlanTitle>
                <PlanDescription>Align chat primitives with blocks before mirroring to web.</PlanDescription>
              </div>
              <PlanAction>
                <PlanTrigger />
              </PlanAction>
            </PlanHeader>
            <PlanContent>
              <PlanStep status="complete" label="Audit @peri/ui gaps" />
              <PlanStep status="active" label="Add chat primitives" />
              <PlanStep status="pending" label="Mirror to web widgets" />
            </PlanContent>
          </Plan>
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'task')}>
      <CatalogDemo id="task" title="Task / Tool activity" description="Fenix 风格工具活动行。">
        <ChatFrame>
          <ToolActivityGroup>
            <ToolActivityRow
              icon={FileText}
              title="Opened packages/ui/src/components/Task.tsx"
              subtitle="Lines 1–97"
              input="packages/ui/src/components/Task.tsx"
              output={'{\n  "lines": 97\n}'}
              status="done"
              duration="120ms"
            />
            <ToolActivityRow
              icon={Terminal}
              title="Running $ bun run test"
              input="bun run test"
              status="running"
            />
            <ToolActivityRow
              icon={FolderSearch}
              title={'Matched "docs/**/*.md"'}
              error="ENOENT: docs missing in sandbox"
              input="docs/**/*.md"
              status="failed"
              duration="1.8s"
            />
          </ToolActivityGroup>
        </ChatFrame>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'queue')}>
      <CatalogDemo id="queue" title="Queue" description="Composer 待发消息队列；hover 显示灰底与操作按钮。">
        <div class="max-w-(--composer-launch-max)">
          <ComposerQueue
            items={[
              {
                id: 'queued-1',
                preview: 'inline 编辑不要有边框，高度和位置要对齐，减少布局抖动',
                hasAttachment: true,
              },
            ]}
          />
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'reasoning')}>
      <CatalogDemo id="reasoning" title="Reasoning" description="折叠式模型推理摘要。">
        <Reasoning>
          <ReasoningTrigger>Why this answer</ReasoningTrigger>
          <ReasoningContent>Model reasoning preview for catalog.</ReasoningContent>
        </Reasoning>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'attachments')}>
      <CatalogDemo id="attachments" title="Attachments" description="grid / inline / list 变体与悬停预览。">
        <div class="flex max-w-md flex-col gap-16">
          <Attachments variant="grid">
            <Attachment
              data={{ ...attachmentFiles[1], url: 'https://picsum.photos/seed/peri/96/96' }}
              onRemove={() => undefined}
            >
              <AttachmentHoverCard>
                <AttachmentHoverCardTrigger>
                  <AttachmentPreview />
                </AttachmentHoverCardTrigger>
                <AttachmentHoverCardContent>
                  <img
                    src="https://picsum.photos/seed/peri/240/160"
                    alt="diagram.png preview"
                    class="max-h-160 rounded-6"
                  />
                </AttachmentHoverCardContent>
              </AttachmentHoverCard>
              <AttachmentRemove />
            </Attachment>
          </Attachments>
          <Attachments variant="inline">
            <Attachment data={attachmentFiles[0]} onRemove={() => undefined}>
              <AttachmentPreview />
              <AttachmentInfo />
              <AttachmentRemove />
            </Attachment>
          </Attachments>
          <Attachments variant="list">
            <For each={attachmentFiles}>
              {(file) => (
                <Attachment data={file} onRemove={() => undefined}>
                  <AttachmentPreview />
                  <AttachmentInfo showMediaType />
                  <AttachmentRemove />
                </Attachment>
              )}
            </For>
          </Attachments>
          <AttachmentEmpty />
        </div>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'table-primitives')}>
      <CatalogDemo id="table-primitives" title="Table" description="HTML 表格原语（DataTable 的底层）。">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alpha</TableCell>
              <TableCell>Ready</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'data-table')}>
      <CatalogDemo id="data-table" title="Data table" description="客户端排序数据表。">
        <DataTable
          data={tableRows}
          columns={[
            { id: 'name', header: 'Project', accessor: (r) => r.name, sortable: true },
            { id: 'sessions', header: 'Sessions', accessor: (r) => r.sessions, sortable: true },
            { id: 'status', header: 'Status', accessor: (r) => r.status, sortable: true },
          ]}
        />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'questionnaire-option-row')}>
      <CatalogDemo
        id="questionnaire-option-row"
        title="Questionnaire option row"
        description="A/B/C 键位徽章、主副文案与单选/多选控件行。"
      >
        <QuestionnaireOptionRowDemo />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'questionnaire')}>
      <CatalogDemo
        id="questionnaire"
        title="Questionnaire"
        description="AskUserQuestion 多步问卷定稿；生产 QuestionQueue 须镜像此节视觉与页脚导航。"
      >
        <QuestionnaireAskUserDemo />
      </CatalogDemo>
      </Show>
    </>
  );
}
