import { createSignal } from 'solid-js';
import { DecisionQueueShell, QuestionnaireFrame } from '@peri/ui';
import { QuestionnaireAskUserDemo } from '@/pages/demos/QuestionnaireAskUserDemo';

const PERMISSION_OPTIONS = [
  { id: 'once', key: 'A', label: 'Allow once' },
  { id: 'session', key: 'B', label: 'Allow for this session' },
  { id: 'deny', key: 'C', label: 'Deny' },
];

/** Tier 4 · 决策面：Questions + Permissions 共用 QuestionnaireFrame，外包 DecisionQueueShell（T3）。 */
export function DecisionSurfacesLayout() {
  const [permissionId, setPermissionId] = createSignal('once');
  const [permissionIndex, setPermissionIndex] = createSignal(0);

  return (
    <div class="grid max-w-3xl grid-cols-1 gap-16 diff-min:grid-cols-2">
      <div aria-label="Questions demo">
        <QuestionnaireAskUserDemo />
      </div>

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
