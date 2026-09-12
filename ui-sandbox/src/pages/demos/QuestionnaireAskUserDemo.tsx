import { createSignal, For, Show } from 'solid-js';
import {
  DecisionQueueShell,
  Questionnaire,
  QuestionnaireNavigation,
  QuestionnaireStep,
  type QuestionnaireAnswer,
  chatColumnClass,
} from '@peri/ui';

type AskUserStepFixture = {
  id: string;
  title: string;
  description?: string;
  multiple?: boolean;
  choices: Array<{ value: string; label: string; description?: string }>;
};

/** Catalog 定稿夹具；生产 `QuestionQueue` 须镜像此视觉与交互。 */
const ASK_USER_STEPS: AskUserStepFixture[] = [
  {
    id: 'question-0',
    title: '下一步',
    description: '你希望接下来优先处理哪类任务？',
    choices: [
      { value: '继续 peri-studio 功能/修复', label: '继续 peri-studio 功能/修复', description: '在仓库内改代码、跑测试、对齐架构文档' },
      { value: '解释或梳理现有代码', label: '解释或梳理现有代码', description: '只读分析，不写代码' },
      { value: '规划/设计/文档', label: '规划/设计/文档', description: '方案、ADR、UI spec、任务拆分' },
      { value: '其他（我会在下一步说明）', label: '其他（我会在下一步说明）', description: '自定义方向' },
    ],
  },
  {
    id: 'question-1',
    title: '交付范围',
    description: '这次希望覆盖哪些产出？（可多选）',
    multiple: true,
    choices: [
      { value: '实现代码改动', label: '实现代码改动' },
      { value: '补测试', label: '补测试' },
      { value: '更新文档', label: '更新文档' },
    ],
  },
  {
    id: 'question-2',
    title: '需要额外说明吗？',
    choices: [
      { value: '不需要', label: '不需要' },
      { value: '需要', label: '需要' },
    ],
  },
];

function answersToPayload(answers: Record<string, QuestionnaireAnswer>): string[] {
  return ASK_USER_STEPS.map((step) => {
    const value = answers[step.id];
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    return value;
  });
}

/** Catalog · AskUserQuestion 多步问卷定稿（`@peri/ui` Questionnaire 壳）。 */
export function QuestionnaireAskUserDemo() {
  const [answers, setAnswers] = createSignal<Record<string, QuestionnaireAnswer>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [lastSubmit, setLastSubmit] = createSignal<string[] | null>(null);

  const submitAnswers = (record: Record<string, QuestionnaireAnswer>) => {
    if (submitting()) return;
    const payload = answersToPayload(record);
    for (let index = 0; index < ASK_USER_STEPS.length; index += 1) {
      const skipped = record[ASK_USER_STEPS[index].id] === null;
      if (skipped) continue;
      if (!payload[index]) return;
    }
    setLastSubmit(payload);
    setSubmitting(true);
    window.setTimeout(() => setSubmitting(false), 800);
  };

  return (
    <div class="flex flex-col gap-12">
      <DecisionQueueShell class={`${chatColumnClass} pb-10`} aria-label="AskUserQuestion demo">
        <Questionnaire
          class="mx-auto w-full max-w-(--container-search)"
          data-testid="questionnaire-ask-user-demo"
          title="Questions"
          pagerShowNext={false}
          answers={answers()}
          onAnswersChange={setAnswers}
          onSubmit={submitAnswers}
          aria-busy={submitting() ? 'true' : undefined}
          headerActions={(
            <span class="inline-flex items-center gap-4 text-10 text-text-muted">
              Expires soon
            </span>
          )}
        >
          <For each={ASK_USER_STEPS}>
            {(step) => (
              <QuestionnaireStep
                id={step.id}
                title={step.title}
                description={step.description}
                required
                multiple={step.multiple}
                choices={step.choices}
              />
            )}
          </For>
          <QuestionnaireNavigation
            skipDisabled={submitting()}
            submitDisabled={submitting()}
            submitBusy={submitting()}
          />
        </Questionnaire>
      </DecisionQueueShell>
      <Show when={lastSubmit()}>
        {(payload) => (
          <pre class="m-0 overflow-x-auto rounded-8 border border-border-subtle bg-surface-muted p-12 text-11 leading-18 text-content-secondary">
            {JSON.stringify(payload(), null, 2)}
          </pre>
        )}
      </Show>
    </div>
  );
}
