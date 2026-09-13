import { createSignal, For, Show } from 'solid-js';
import { Clock3, LockKeyhole } from 'lucide-solid';
import {
  Button,
  DecisionQueueShell,
  InlineNotice,
  Questionnaire,
  QuestionnaireNavigation,
  QuestionnaireStep,
  type QuestionnaireAnswer,
  chatColumnClass,
} from '@peri/ui';

type MockQuestionItem = {
  header: string | null;
  question: string;
  multiSelect: boolean;
  options: Array<{ label: string; description?: string | null }>;
};

type AskUserQuestionnaireStep = {
  id: string;
  title: string;
  description?: string;
  required?: boolean;
  multiple?: boolean;
  choices?: Array<{
    value: string;
    label: string;
    description?: string;
  }>;
};

/** 与 `web/src/widgets/chat/QuestionQueue.test.tsx` 对齐的夹具。 */
const MOCK_QUESTIONS: MockQuestionItem[] = [
  {
    header: '下一步',
    question: '你希望接下来优先处理哪类任务？',
    multiSelect: false,
    options: [
      { label: '继续 peri-studio 功能/修复', description: '在仓库内改代码、跑测试、对齐架构文档' },
      { label: '解释或梳理现有代码', description: '只读分析，不写代码' },
      { label: '规划/设计/文档', description: '方案、ADR、UI spec、任务拆分' },
      { label: '其他（我会在下一步说明）', description: '自定义方向' },
    ],
  },
  {
    header: '交付范围',
    question: '这次希望覆盖哪些产出？（可多选）',
    multiSelect: true,
    options: [
      { label: '实现代码改动' },
      { label: '补测试' },
      { label: '更新文档' },
    ],
  },
  {
    header: null,
    question: '需要额外说明吗？',
    multiSelect: false,
    options: [
      { label: '不需要' },
      { label: '需要' },
    ],
  },
];

const MOCK_QUEUE = [
  { id: 'q-1', expiresAt: true, items: MOCK_QUESTIONS },
  { id: 'q-2', expiresAt: false, items: MOCK_QUESTIONS.slice(0, 2) },
] as const;

function questionStepId(index: number) {
  return `question-${index}`;
}

function stepTitle(item: MockQuestionItem) {
  return item.header || item.question;
}

function stepDescription(item: MockQuestionItem) {
  return item.header ? item.question : undefined;
}

function questionToSteps(items: MockQuestionItem[]): AskUserQuestionnaireStep[] {
  return items.map((item, index) => ({
    id: questionStepId(index),
    title: stepTitle(item),
    description: stepDescription(item),
    required: true,
    multiple: item.multiSelect,
    choices: item.options.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description ?? undefined,
    })),
  }));
}

function canSubmit(
  record: Record<string, QuestionnaireAnswer>,
  steps: AskUserQuestionnaireStep[],
): boolean {
  for (const step of steps) {
    if (record[step.id] === null) continue;
    if (!step.required) continue;
    const value = record[step.id];
    const empty = value === undefined
      || value === ''
      || (Array.isArray(value) && value.length === 0);
    if (empty) return false;
  }
  return true;
}

function answersToPayload(
  answers: Record<string, QuestionnaireAnswer>,
  items: MockQuestionItem[],
): string[] {
  return items.map((_, index) => {
    const value = answers[questionStepId(index)];
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    return value;
  });
}

/** Catalog · 镜像生产 `AskUserQuestionnaireShell` / `QuestionQueue` 装配。 */
export function QuestionnaireAskUserDemo() {
  const [queueIndex, setQueueIndex] = createSignal(0);
  const [answersByQuestion, setAnswersByQuestion] = createSignal<Record<string, Record<string, QuestionnaireAnswer>>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [confirmed, setConfirmed] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  const [locked, setLocked] = createSignal(false);
  const [lastSubmit, setLastSubmit] = createSignal<string[] | null>(null);

  const currentQuestion = () => MOCK_QUEUE[queueIndex()];
  const steps = () => questionToSteps(currentQuestion().items);
  const answers = () => answersByQuestion()[currentQuestion().id] ?? {};

  const syncAnswers = (next: Record<string, QuestionnaireAnswer>) => {
    const questionId = currentQuestion().id;
    setAnswersByQuestion((current) => ({ ...current, [questionId]: next }));
  };

  const submitAnswers = (record: Record<string, QuestionnaireAnswer>) => {
    if (locked() || submitting() || confirmed()) return;
    if (!canSubmit(record, steps())) return;
    setLastSubmit(answersToPayload(record, currentQuestion().items));
    setSubmitting(true);
    window.setTimeout(() => {
      setSubmitting(false);
      setConfirmed(true);
    }, 800);
  };

  const resetDemo = () => {
    setSubmitting(false);
    setConfirmed(false);
    setUncertain(false);
    setLocked(false);
    setLastSubmit(null);
  };

  return (
    <div class="flex flex-col gap-12">
      <DecisionQueueShell class={`${chatColumnClass} pb-10`} aria-label="Pending questions">
        <Show when={confirmed()}>
          <p class="my-4 text-12 text-text-secondary">Answers sent. Peri will continue when the server confirms.</p>
        </Show>
        <Show when={uncertain()}>
          <InlineNotice
            class="my-4"
            tone="warning"
            role="alert"
            title="Answer delivery not confirmed"
          >
            <p class="my-4">Refresh the server status, or hide this question locally. The original answer cannot be sent again.</p>
            <div class="flex flex-wrap gap-8">
              <Button type="button" size="compact" variant="secondary" onClick={() => setUncertain(false)}>Refresh status</Button>
              <Button type="button" size="compact" variant="secondary" class="pointer-coarse:min-h-44!" onClick={() => setUncertain(false)}>Hide question</Button>
            </div>
          </InlineNotice>
        </Show>
        <Show when={!confirmed() && !uncertain()}>
          <Show when={locked()}>
            <p class="mb-8 inline-flex items-center gap-6 text-11 text-text-muted">
              <LockKeyhole size={12} aria-hidden="true" />
              Waiting for server confirmation
            </p>
          </Show>
          <Questionnaire
            class="mx-auto w-full max-w-(--container-search)"
            data-testid="question-queue-card"
            title="Questions"
            currentIndex={queueIndex()}
            total={MOCK_QUEUE.length}
            onPrevious={() => {
              resetDemo();
              setQueueIndex((index) => Math.max(0, index - 1));
            }}
            onNext={() => {
              resetDemo();
              setQueueIndex((index) => Math.min(MOCK_QUEUE.length - 1, index + 1));
            }}
            pagerPreviousLabel="Previous question"
            pagerNextLabel="Next question"
            pagerShowNext={MOCK_QUEUE.length > 1}
            answers={answers()}
            onAnswersChange={syncAnswers}
            onSubmit={submitAnswers}
            aria-busy={submitting() ? 'true' : undefined}
            headerActions={(
              <Show when={currentQuestion().expiresAt}>
                <span class="inline-flex items-center gap-4 text-10 text-text-muted">
                  <Clock3 size={12} aria-hidden="true" />
                  Expires soon
                </span>
              </Show>
            )}
          >
            <For each={steps()}>
              {(step) => (
                <QuestionnaireStep
                  id={step.id}
                  title={step.title}
                  description={step.description}
                  required={step.required}
                  multiple={step.multiple}
                  choices={step.choices}
                />
              )}
            </For>
            <QuestionnaireNavigation
              skipDisabled={locked()}
              submitDisabled={locked()}
              submitBusy={submitting()}
            />
          </Questionnaire>
        </Show>
      </DecisionQueueShell>
      <div class="flex flex-wrap gap-8">
        <Button type="button" size="compact" variant="secondary" onClick={resetDemo}>Reset</Button>
        <Button type="button" size="compact" variant="secondary" onClick={() => { resetDemo(); setLocked((value) => !value); }}>Toggle locked</Button>
        <Button type="button" size="compact" variant="secondary" onClick={() => { resetDemo(); setUncertain(true); }}>Show uncertain</Button>
      </div>
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
