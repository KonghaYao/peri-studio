import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockLanguageSelector,
  CodeBlockTitle,
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
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
  Questionnaire,
  QuestionnaireNavigation,
  QuestionnaireProgress,
  QuestionnaireStep,
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemFile,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
  Snippet,
  SnippetAddon,
  SnippetCopyButton,
  SnippetInput,
  SnippetText,
  SourceItem,
  Sources,
  SourcesContent,
  SourcesTrigger,
  Suggestion,
  SuggestionItem,
  Task,
  TaskContent,
  TaskItem,
  TaskItemFile,
  TaskTrigger,
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

const tableRows = [
  { id: 'p1', name: 'peri-studio', sessions: 12, status: 'active' },
  { id: 'p2', name: 'docs-site', sessions: 3, status: 'archived' },
  { id: 'p3', name: 'ui-sandbox', sessions: 8, status: 'active' },
];

const codeSamples = {
  typescript: 'const ready = await status("--ready");',
  bash: 'bun run test',
};

export function ComponentCatalogExtrasG(props: { sections?: string[] }) {
  const [approvalState, setApprovalState] = createSignal<'approval-requested' | 'approval-responded'>(
    'approval-requested',
  );
  const [approved, setApproved] = createSignal<boolean | undefined>(undefined);
  const [codeLanguage, setCodeLanguage] = createSignal<'typescript' | 'bash'>('typescript');

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'suggestion')}>
      <CatalogDemo id="suggestion" title="Suggestion" description="快捷建议 chips。">
        <Suggestion>
          <SuggestionItem suggestion="Summarize this session" onClick={() => undefined} />
          <SuggestionItem suggestion="Write tests" onClick={() => undefined} />
          <SuggestionItem suggestion="Explain architecture" onClick={() => undefined} />
        </Suggestion>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'sources')}>
      <CatalogDemo id="sources" title="Sources" description="引用来源折叠列表。">
        <Sources defaultOpen>
          <SourcesTrigger count={2} />
          <SourcesContent>
            <SourceItem href="https://example.com/architecture" title="architecture.md" />
            <SourceItem href="https://example.com/terminology" title="terminology.md" />
          </SourcesContent>
        </Sources>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'citation')}>
      <CatalogDemo id="citation" title="Inline citation" description="行内引用 hover 卡片与轮播来源。">
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
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'plan')}>
      <CatalogDemo id="plan" title="Plan" description="可折叠计划卡与流式标题。">
        <Plan defaultOpen isStreaming>
          <PlanHeader>
            <div class="min-w-0 flex-1 space-y-4">
              <PlanTitle>Implementation plan</PlanTitle>
              <PlanDescription>Align chat primitives with AI Elements before mirroring to web.</PlanDescription>
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
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'task')}>
      <CatalogDemo id="task" title="Task" description="可折叠搜索任务与文件 chip。">
        <Task defaultOpen>
          <TaskTrigger title="Searching repository" />
          <TaskContent>
            <TaskItem>
              Read <TaskItemFile>packages/ui/src/components/Task.tsx</TaskItemFile>
            </TaskItem>
            <TaskItem>
              Matched <TaskItemFile>docs/architecture.md</TaskItemFile>
            </TaskItem>
          </TaskContent>
        </Task>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'confirmation')}>
      <CatalogDemo id="confirmation" title="Confirmation" description="敏感操作审批与响应态。">
        <DemoRow>
          <Confirmation
            state={approvalState()}
            approval={{ id: 'delete-session', approved: approved() }}
          >
            <ConfirmationRequest>
              <ConfirmationTitle>Allow deleting session "debug-42"?</ConfirmationTitle>
              <ConfirmationActions>
                <ConfirmationAction
                  variant="primary"
                  onClick={() => {
                    setApproved(true);
                    setApprovalState('approval-responded');
                  }}
                >
                  Approve
                </ConfirmationAction>
                <ConfirmationAction
                  variant="ghost"
                  onClick={() => {
                    setApproved(false);
                    setApprovalState('approval-responded');
                  }}
                >
                  Deny
                </ConfirmationAction>
              </ConfirmationActions>
            </ConfirmationRequest>
            <ConfirmationAccepted>
              <ConfirmationTitle>Delete approved.</ConfirmationTitle>
            </ConfirmationAccepted>
            <ConfirmationRejected>
              <ConfirmationTitle>Delete denied.</ConfirmationTitle>
            </ConfirmationRejected>
          </Confirmation>
        </DemoRow>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'queue')}>
      <CatalogDemo id="queue" title="Queue" description="分段待办队列与完成态。">
        <Queue>
          <QueueSection defaultOpen>
            <QueueSectionTrigger>
              <QueueSectionLabel count={2} label="tasks" />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList>
                <QueueItem>
                  <div class="flex items-start gap-8">
                    <QueueItemIndicator completed />
                    <QueueItemContent completed>Index repository</QueueItemContent>
                  </div>
                </QueueItem>
                <QueueItem>
                  <div class="flex min-w-0 items-start gap-8">
                    <QueueItemIndicator />
                    <div class="min-w-0 flex-1">
                      <QueueItemContent>Generate summary</QueueItemContent>
                      <QueueItemDescription>Uses latest chat transcript</QueueItemDescription>
                    </div>
                  </div>
                </QueueItem>
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        </Queue>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'code-block')}>
      <CatalogDemo id="code-block" title="Code block" description="Header、语言切换与复制。">
        <CodeBlock
          code={codeSamples[codeLanguage()]}
          language={codeLanguage()}
          showLineNumbers
          startLine={1}
        >
          <CodeBlockHeader>
            <CodeBlockTitle>
              <CodeBlockFilename>demo.{codeLanguage() === 'typescript' ? 'ts' : 'sh'}</CodeBlockFilename>
            </CodeBlockTitle>
            <CodeBlockActions>
              <CodeBlockLanguageSelector
                aria-label="Language"
                value={codeLanguage()}
                onChange={(value) => setCodeLanguage(value as 'typescript' | 'bash')}
                options={[
                  { value: 'typescript', label: 'TypeScript' },
                  { value: 'bash', label: 'Bash' },
                ]}
              />
              <CodeBlockCopyButton />
            </CodeBlockActions>
          </CodeBlockHeader>
        </CodeBlock>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'snippet')}>
      <CatalogDemo id="snippet" title="Snippet" description="安装命令可复制片段。">
        <DemoRow>
          <Snippet code="bun run test" prefix="$" />
          <Snippet code="npx ai-elements add task">
            <SnippetAddon>
              <SnippetText>$</SnippetText>
            </SnippetAddon>
            <SnippetInput />
            <SnippetAddon align="inline-end" class="px-4">
              <SnippetCopyButton />
            </SnippetAddon>
          </Snippet>
        </DemoRow>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'typeset')}>
      <CatalogDemo id="typeset" title="Typeset" description="流式 Markdown 排版（typeset.css）。">
        <div class="typeset typeset-chat max-w-md rounded-8 border border-border-subtle p-16 text-13">
          <h3>Streaming markdown</h3>
          <p>Lists and <code>inline code</code> scale from the container.</p>
          <ul>
            <li>Anchor turns on new messages</li>
            <li>Preserve scroll on prepend</li>
          </ul>
        </div>
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

      <Show when={showCatalogSection(props.sections, 'questionnaire')}>
      <CatalogDemo id="questionnaire" title="Questionnaire" description="多步问答流（shadcn 2026-08）。">
        <Questionnaire class="max-w-md" onSubmit={() => undefined}>
          <QuestionnaireProgress aria-label="Question progress" />
          <QuestionnaireStep
            id="direction"
            title="What should the agent build next?"
            required
            choices={[
              { value: 'timeline', label: 'Tool call timeline' },
              { value: 'approval', label: 'Approval checkpoints' },
            ]}
          />
          <QuestionnaireStep
            id="detail"
            title="How much detail?"
            choices={[
              { value: 'focused', label: 'Focused' },
              { value: 'complete', label: 'Complete flow' },
            ]}
          />
          <QuestionnaireNavigation />
        </Questionnaire>
      </CatalogDemo>
      </Show>
    </>
  );
}
