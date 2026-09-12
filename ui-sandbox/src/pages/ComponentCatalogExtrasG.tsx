import { createSignal, For, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  Button,
  CodeBlock,
  Confirmation,
  ConfirmationActions,
  ConfirmationTitle,
  DataTable,
  InlineCitation,
  InlineCitationCard,
  InlineCitationQuote,
  Plan,
  PlanContent,
  PlanHeader,
  PlanStep,
  Questionnaire,
  QuestionnaireNavigation,
  QuestionnaireProgress,
  QuestionnaireStep,
  Queue,
  QueueItem,
  QueueItemIndicator,
  Snippet,
  SourceItem,
  Sources,
  SourcesContent,
  SourcesTrigger,
  Suggestion,
  SuggestionItem,
  Task,
  TaskItem,
  TaskItemDescription,
  TaskItemTitle,
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

const tableRows = [
  { id: 'p1', name: 'peri-studio', sessions: 12, status: 'active' },
  { id: 'p2', name: 'docs-site', sessions: 3, status: 'archived' },
  { id: 'p3', name: 'ui-sandbox', sessions: 8, status: 'active' },
];

export function ComponentCatalogExtrasG(props: { sections?: string[] }) {
  const [taskDone, setTaskDone] = createSignal(false);

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
      <CatalogDemo id="citation" title="Inline citation" description="行内引用 hover 卡片。">
        <p class="text-13 text-content-primary">
          Session recovery uses explicit load
          <InlineCitation>
            <InlineCitationCard sources={['https://example.com/architecture']}>
              <InlineCitationQuote>
                Server restart does not resurrect old runtime; chat/load rebuilds the view.
              </InlineCitationQuote>
            </InlineCitationCard>
          </InlineCitation>
          per the control plane contract.
        </p>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'plan')}>
      <CatalogDemo id="plan" title="Plan" description="Agent 计划时间线。">
        <Plan defaultOpen>
          <PlanHeader>Implementation plan</PlanHeader>
          <PlanContent>
            <PlanStep status="complete" label="Audit @peri/ui gaps" />
            <PlanStep status="active" label="Add chat primitives" />
            <PlanStep status="pending" label="Mirror to web widgets" />
          </PlanContent>
        </Plan>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'task')}>
      <CatalogDemo id="task" title="Task" description="可勾选任务列表。">
        <Task>
          <TaskItem checked={taskDone()} onCheckedChange={setTaskDone}>
            <TaskItemTitle>Run packages/ui tests</TaskItemTitle>
            <TaskItemDescription>177+ vitest cases</TaskItemDescription>
          </TaskItem>
          <TaskItem>
            <TaskItemTitle>Add sandbox demos</TaskItemTitle>
          </TaskItem>
        </Task>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'confirmation')}>
      <CatalogDemo id="confirmation" title="Confirmation" description="敏感操作审批。">
        <Confirmation
          state="approval-requested"
          approval={{ id: 'delete-session' }}
        >
          <ConfirmationTitle>Allow deleting session "debug-42"?</ConfirmationTitle>
          <ConfirmationActions state="approval-requested">
            <Button size="sm" variant="primary">Approve</Button>
            <Button size="sm" variant="ghost">Deny</Button>
          </ConfirmationActions>
        </Confirmation>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'queue')}>
      <CatalogDemo id="queue" title="Queue" description="待处理工作队列。">
        <Queue>
          <QueueItem>
            <QueueItemIndicator completed />
            <span class="text-13 text-content-secondary">Index repository</span>
          </QueueItem>
          <QueueItem>
            <QueueItemIndicator />
            <span class="text-13 text-content-primary">Generate summary</span>
          </QueueItem>
        </Queue>
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'code-block')}>
      <CatalogDemo id="code-block" title="Code block" description="带复制与语言标签的代码块。">
        <CodeBlock language="typescript" code={'const ready = await status("--ready");'} />
      </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'snippet')}>
      <CatalogDemo id="snippet" title="Snippet" description="紧凑可复制代码片段。">
        <Snippet code="bun run test" prefix="$" />
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
