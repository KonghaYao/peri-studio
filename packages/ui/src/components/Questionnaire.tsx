import {
  createContext,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  splitProps,
  useContext,
  type Accessor,
  type Component,
  type JSX,
  type ParentComponent,
} from 'solid-js';
import { createControllableSignal } from '../lib/controllable-state';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Checkbox, CheckboxControl, CheckboxInput, CheckboxLabel } from './Checkbox';
import { Progress, ProgressFill, ProgressTrack } from './Progress';
import { RadioGroup, RadioGroupItem, RadioGroupItemControl, RadioGroupItemInput, RadioGroupItemLabel } from './RadioGroup';
import { Textarea } from './Textarea';

export type QuestionnaireChoice = {
  value: string;
  label: string;
  description?: string;
};

export type QuestionnaireAnswer = string | string[] | null;

export type QuestionnaireStepConfig = {
  id: string;
  title: string;
  description?: string;
  required?: boolean;
  multiple?: boolean;
  choices?: QuestionnaireChoice[];
  allowText?: boolean;
  textLabel?: string;
  textPlaceholder?: string;
};

type RegisteredStep = QuestionnaireStepConfig & { order: number };

type QuestionnaireContextValue = {
  steps: Accessor<RegisteredStep[]>;
  currentIndex: Accessor<number>;
  currentStep: Accessor<RegisteredStep | undefined>;
  answers: Accessor<Record<string, QuestionnaireAnswer>>;
  error: Accessor<string | undefined>;
  setAnswer: (stepId: string, value: QuestionnaireAnswer) => void;
  getAnswer: (stepId: string) => QuestionnaireAnswer;
  registerStep: (config: QuestionnaireStepConfig) => void;
  unregisterStep: (stepId: string) => void;
  goPrevious: () => void;
  goNext: () => void;
  skipStep: () => void;
  submit: () => void;
  canGoPrevious: Accessor<boolean>;
  canGoNext: Accessor<boolean>;
  isLastStep: Accessor<boolean>;
  progressValue: Accessor<number>;
};

const QuestionnaireContext = createContext<QuestionnaireContextValue>();

function useQuestionnaireContext(component: string) {
  const context = useContext(QuestionnaireContext);
  if (!context) {
    throw new Error(`${component} must be used within Questionnaire`);
  }
  return context;
}

function isAnswered(value: QuestionnaireAnswer, step: RegisteredStep) {
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (step.allowText && step.choices?.length) {
    return value.trim().length > 0;
  }
  return value.trim().length > 0;
}

function validateStep(step: RegisteredStep, answer: QuestionnaireAnswer) {
  if (!step.required) return undefined;
  if (!isAnswered(answer, step)) {
    return 'Choose an answer to continue.';
  }
  return undefined;
}

type QuestionnaireProps = {
  step?: number;
  defaultStep?: number;
  onStepChange?: (step: number) => void;
  answers?: Record<string, QuestionnaireAnswer>;
  defaultAnswers?: Record<string, QuestionnaireAnswer>;
  onAnswersChange?: (answers: Record<string, QuestionnaireAnswer>) => void;
  onSubmit?: (answers: Record<string, QuestionnaireAnswer>) => void;
  class?: string;
  children?: JSX.Element;
};

/** 多步问卷根容器：管理步骤、答案、校验与导航，不依赖外部表单库。 */
export const Questionnaire: ParentComponent<QuestionnaireProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'step',
    'defaultStep',
    'onStepChange',
    'answers',
    'defaultAnswers',
    'onAnswersChange',
    'onSubmit',
    'class',
    'children',
  ]);

  const registry = new Map<string, RegisteredStep>();
  const [steps, setSteps] = createSignal<RegisteredStep[]>([]);
  let nextOrder = 0;

  const syncSteps = () => {
    setSteps(
      Array.from(registry.values()).sort((left, right) => left.order - right.order),
    );
  };

  const registerStep = (config: QuestionnaireStepConfig) => {
    const order = registry.get(config.id)?.order ?? nextOrder++;
    registry.set(config.id, { ...config, order });
    syncSteps();
  };

  const unregisterStep = (stepId: string) => {
    registry.delete(stepId);
    syncSteps();
  };

  const [currentIndex, setCurrentIndex] = createControllableSignal<number>({
    prop: () => local.step,
    defaultProp: local.defaultStep ?? 0,
    onChange: local.onStepChange,
  });

  const [answers, setAnswers] = createControllableSignal<Record<string, QuestionnaireAnswer>>({
    prop: () => local.answers,
    defaultProp: local.defaultAnswers ?? {},
    onChange: local.onAnswersChange,
  });

  const [error, setError] = createSignal<string | undefined>();
  const currentStep = createMemo(() => steps()[currentIndex()]);
  const isLastStep = createMemo(() => currentIndex() >= Math.max(steps().length - 1, 0));
  const canGoPrevious = createMemo(() => currentIndex() > 0);
  const canGoNext = createMemo(() => !isLastStep());
  const progressValue = createMemo(() => {
    const total = steps().length;
    if (total === 0) return 0;
    return Math.round(((currentIndex() + 1) / total) * 100);
  });

  const getAnswer = (stepId: string) => answers()[stepId] ?? null;

  const setAnswer = (stepId: string, value: QuestionnaireAnswer) => {
    setAnswers({ ...answers(), [stepId]: value });
    if (currentStep()?.id === stepId) {
      setError(undefined);
    }
  };

  const goPrevious = () => {
    if (!canGoPrevious()) return;
    setError(undefined);
    setCurrentIndex(currentIndex() - 1);
  };

  const goNext = () => {
    const step = currentStep();
    if (!step) return;
    const validationError = validateStep(step, getAnswer(step.id));
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(undefined);
    if (isLastStep()) {
      local.onSubmit?.(answers());
      return;
    }
    setCurrentIndex(currentIndex() + 1);
  };

  const skipStep = () => {
    const step = currentStep();
    if (!step || step.required) return;
    setAnswer(step.id, null);
    setError(undefined);
    if (isLastStep()) {
      local.onSubmit?.({ ...answers(), [step.id]: null });
      return;
    }
    setCurrentIndex(currentIndex() + 1);
  };

  const submit = () => {
    const step = currentStep();
    if (!step) return;
    const validationError = validateStep(step, getAnswer(step.id));
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(undefined);
    local.onSubmit?.(answers());
  };

  const context: QuestionnaireContextValue = {
    steps,
    currentIndex,
    currentStep,
    answers,
    error,
    setAnswer,
    getAnswer,
    registerStep,
    unregisterStep,
    goPrevious,
    goNext,
    skipStep,
    submit,
    canGoPrevious,
    canGoNext,
    isLastStep,
    progressValue,
  };

  return (
    <QuestionnaireContext.Provider value={context}>
      <div
        data-slot="questionnaire"
        class={cn('flex flex-col gap-16', local.class)}
        {...rest}
      >
        {local.children}
      </div>
    </QuestionnaireContext.Provider>
  );
};

type QuestionnaireStepProps = QuestionnaireStepConfig & {
  class?: string;
};

/** 单个问卷步骤：注册到 Questionnaire 后仅在激活时渲染。 */
export const QuestionnaireStep: Component<QuestionnaireStepProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'id',
    'title',
    'description',
    'required',
    'multiple',
    'choices',
    'allowText',
    'textLabel',
    'textPlaceholder',
    'class',
  ]);
  const context = useQuestionnaireContext('QuestionnaireStep');

  context.registerStep({
    id: local.id,
    title: local.title,
    description: local.description,
    required: local.required,
    multiple: local.multiple,
    choices: local.choices,
    allowText: local.allowText,
    textLabel: local.textLabel,
    textPlaceholder: local.textPlaceholder,
  });
  onCleanup(() => context.unregisterStep(local.id));

  const active = () => context.currentStep()?.id === local.id;
  const answer = () => context.getAnswer(local.id);
  const choices = () => local.choices ?? [];
  const hasChoices = () => choices().length > 0;
  const showText = () => local.allowText || !hasChoices();

  const toggleMultiple = (value: string, checked: boolean) => {
    const current = Array.isArray(answer()) ? [...answer() as string[]] : [];
    const next = checked
      ? [...current, value]
      : current.filter((item) => item !== value);
    context.setAnswer(local.id, next);
  };

  return (
    <Show when={active()}>
      <fieldset
        data-slot="questionnaire-step"
        data-step-id={local.id}
        class={cn('m-0 flex min-w-0 flex-col gap-12 border-0 p-0', local.class)}
        aria-invalid={context.error() ? 'true' : undefined}
        {...rest}
      >
        <legend class="text-16 font-semibold text-content-primary">{local.title}</legend>
        <Show when={local.description}>
          <p class="m-0 text-13 text-content-muted">{local.description}</p>
        </Show>

        <Show when={hasChoices() && !local.multiple}>
          <RadioGroup
            value={typeof answer() === 'string' ? answer() as string : ''}
            onChange={(value) => context.setAnswer(local.id, value)}
            class="flex flex-col gap-8"
          >
            <For each={choices()}>
              {(choice) => (
                <RadioGroupItem value={choice.value} class="flex items-start gap-8">
                  <RadioGroupItemInput />
                  <RadioGroupItemControl />
                  <div class="flex min-w-0 flex-col gap-2">
                    <RadioGroupItemLabel class="text-13 font-medium text-content-primary">
                      {choice.label}
                    </RadioGroupItemLabel>
                    <Show when={choice.description}>
                      <span class="text-12 text-content-muted">{choice.description}</span>
                    </Show>
                  </div>
                </RadioGroupItem>
              )}
            </For>
          </RadioGroup>
        </Show>

        <Show when={hasChoices() && local.multiple}>
          <div class="flex flex-col gap-8">
            <For each={choices()}>
              {(choice) => {
                const checked = () => Array.isArray(answer()) && (answer() as string[]).includes(choice.value);
                return (
                  <Checkbox
                    checked={checked()}
                    onChange={(value) => toggleMultiple(choice.value, value)}
                    class="flex items-start gap-8"
                  >
                    <CheckboxInput />
                    <CheckboxControl />
                    <div class="flex min-w-0 flex-col gap-2">
                      <CheckboxLabel class="text-13 font-medium text-content-primary">
                        {choice.label}
                      </CheckboxLabel>
                      <Show when={choice.description}>
                        <span class="text-12 text-content-muted">{choice.description}</span>
                      </Show>
                    </div>
                  </Checkbox>
                );
              }}
            </For>
          </div>
        </Show>

        <Show when={showText()}>
          <Textarea
            variant="field"
            label={local.textLabel}
            placeholder={local.textPlaceholder}
            value={typeof answer() === 'string' ? answer() as string : ''}
            onInput={(event) => context.setAnswer(local.id, event.currentTarget.value)}
          />
        </Show>

        <Show when={context.error()}>
          <p role="alert" class="m-0 text-13 text-danger">{context.error()}</p>
        </Show>
      </fieldset>
    </Show>
  );
};

/** 问卷进度条。 */
export const QuestionnaireProgress: Component<{ class?: string; 'aria-label'?: string }> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'aria-label']);
  const context = useQuestionnaireContext('QuestionnaireProgress');
  const label = () => local['aria-label'] ?? 'Questionnaire progress';

  return (
    <Progress
      value={context.progressValue()}
      aria-label={label()}
      data-slot="questionnaire-progress"
      class={cn('w-full', local.class)}
      {...rest}
    >
      <ProgressTrack>
        <ProgressFill />
      </ProgressTrack>
    </Progress>
  );
};

type QuestionnaireNavigationProps = {
  class?: string;
  previousLabel?: string;
  nextLabel?: string;
  skipLabel?: string;
  submitLabel?: string;
};

/** 问卷导航：上一步、下一步、跳过与提交。 */
export const QuestionnaireNavigation: Component<QuestionnaireNavigationProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'previousLabel',
    'nextLabel',
    'skipLabel',
    'submitLabel',
  ]);
  const context = useQuestionnaireContext('QuestionnaireNavigation');
  const canSkip = () => {
    const step = context.currentStep();
    return !!step && !step.required;
  };

  return (
    <div
      data-slot="questionnaire-navigation"
      class={cn('flex flex-wrap items-center gap-8', local.class)}
      {...rest}
    >
      <Button
        type="button"
        variant="ghost"
        disabled={!context.canGoPrevious()}
        onClick={() => context.goPrevious()}
      >
        {local.previousLabel ?? 'Previous'}
      </Button>

      <div class="ml-auto flex flex-wrap items-center gap-8">
        <Show when={canSkip()}>
          <Button type="button" variant="ghost" onClick={() => context.skipStep()}>
            {local.skipLabel ?? 'Skip'}
          </Button>
        </Show>

        <Show
          when={context.isLastStep()}
          fallback={
            <Button type="button" variant="primary" onClick={() => context.goNext()}>
              {local.nextLabel ?? 'Next'}
            </Button>
          }
        >
          <Button type="button" variant="primary" onClick={() => context.submit()}>
            {local.submitLabel ?? 'Submit'}
          </Button>
        </Show>
      </div>
    </div>
  );
};
