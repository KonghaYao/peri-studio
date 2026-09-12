import { createSignal } from 'solid-js';
import { DecisionQueueShell, QuestionnaireFrame } from '@peri/ui';

const QUESTION_OPTIONS = [
  { id: 'a', key: 'A', label: '允许直接归档（侧栏隐藏，runtime 可继续在后台）' },
  { id: 'b', key: 'B', label: '必须先关闭 runtime，才能归档' },
  { id: 'c', key: 'C', label: '归档时自动关闭 runtime，再隐藏' },
  { id: 'd', key: 'D', label: 'Other…' },
];

const PERMISSION_OPTIONS = [
  { id: 'once', key: 'A', label: 'Allow once' },
  { id: 'session', key: 'B', label: 'Allow for this session' },
  { id: 'deny', key: 'C', label: 'Deny' },
];

/** Tier 4 · 决策面：Questions + Permissions 共用 QuestionnaireFrame，外包 DecisionQueueShell（T3）。 */
export function DecisionSurfacesLayout() {
  const [questionId, setQuestionId] = createSignal('a');
  const [permissionId, setPermissionId] = createSignal('once');
  const [questionIndex, setQuestionIndex] = createSignal(0);
  const [permissionIndex, setPermissionIndex] = createSignal(0);

  return (
    <div class="grid max-w-3xl grid-cols-1 gap-16 diff-min:grid-cols-2">
      <DecisionQueueShell aria-label="Questions demo">
        <QuestionnaireFrame
          title="Questions"
          prompt="归档 session 时，如果该 session 仍有正在运行的 chat，应如何处理？"
          options={QUESTION_OPTIONS}
          selectedId={questionId()}
          onSelect={setQuestionId}
          currentIndex={questionIndex()}
          total={7}
          onPrevious={() => setQuestionIndex((value) => Math.max(0, value - 1))}
          onNext={() => setQuestionIndex((value) => Math.min(6, value + 1))}
        />
      </DecisionQueueShell>

      <DecisionQueueShell aria-label="Permissions demo">
        <QuestionnaireFrame
          title="Permissions"
          prompt="Modify workspace file"
          detail="Command: git status (+1 argument) · Working directory: /workspace/peri-studio"
          options={PERMISSION_OPTIONS}
          selectedId={permissionId()}
          onSelect={setPermissionId}
          currentIndex={permissionIndex()}
          total={3}
          onPrevious={() => setPermissionIndex((value) => Math.max(0, value - 1))}
          onNext={() => setPermissionIndex((value) => Math.min(2, value + 1))}
        />
      </DecisionQueueShell>
    </div>
  );
}
