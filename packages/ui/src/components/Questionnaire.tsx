import {
  createContext,
  createEffect,
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
import { CornerDownLeft } from 'lucide-solid';
import { createControllableSignal } from '../lib/controllable-state';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Progress, ProgressFill, ProgressTrack } from './Progress';
import { Textarea } from './Textarea';
import { QuestionnaireFrame, type QuestionnaireFrameProps } from './QuestionnaireFrame';

export type QuestionnaireChoice = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
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

type NavigationLabels = {
  previousLabel?: string;
  nextLabel?: string;
  skipLabel?: string;
  submitLabel?: string;
  submitDisabled?: boolean;
  submitBusy?: boolean;
};

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
  registerNavigation: (labels: NavigationLabels) => void;
  unregisterNavigation: () => void;
  navigationLabels: Accessor<NavigationLabels>;
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

function choiceKey(index: number) {
  return String.fromCharCode(65 + index);
}

type QuestionnaireProps = {
  title?: string;
  step?: number;
  defaultStep?: number;
  onStepChange?: (step: number) => void;
  answers?: Record<string, QuestionnaireAnswer>;
  defaultAnswers?: Record<string, QuestionnaireAnswer>;
  onAnswersChange?: (answers: Record<string, QuestionnaireAnswer>) => void;
  onSubmit?: (answers: Record<string, QuestionnaireAnswer>) => void;
  headerActions?: JSX.Element;
  /** 置于步骤标题之前（如 AskUserQuestion 总说明）。 */
  leading?: JSX.Element;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  class?: string;
  children?: JSX.Element;
} & Pick<
  QuestionnaireFrameProps,
  | 'promptId'
  | 'currentIndex'
  | 'total'
  | 'onPrevious'
  | 'onNext'
  | 'pagerPreviousLabel'
  | 'pagerNextLabel'
  | 'pagerShowNext'
  | 'collapseExpandedLabel'
  | 'collapseCollapsedLabel'
  | 'footer'
  | 'aria-label'
  | 'aria-describedby'
  | 'aria-busy'
  | 'data-testid'
>;

/** 多步问卷：决策面卡壳 + 分页与选项键位样式。 */
export const Questionnaire: ParentComponent<QuestionnaireProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'title',
    'step',
    'defaultStep',
    'onStepChange',
    'answers',
    'defaultAnswers',
    'onAnswersChange',
    'onSubmit',
    'headerActions',
    'leading',
    'expanded',
    'onExpandedChange',
    'class',
    'children',
  ]);

  const registry = new Map<string, RegisteredStep>();
  const [steps, setSteps] = createSignal<RegisteredStep[]>([]);
  let nextOrder = 0;
  const [navigationLabels, setNavigationLabels] = createSignal<NavigationLabels>({});

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

  const registerNavigation = (labels: NavigationLabels) => {
    setNavigationLabels((current) => (
      current.previousLabel === labels.previousLabel
      && current.nextLabel === labels.nextLabel
      && current.skipLabel === labels.skipLabel
      && current.submitLabel === labels.submitLabel
      && current.submitDisabled === labels.submitDisabled
      && current.submitBusy === labels.submitBusy
        ? current
        : labels
    ));
  };

  const unregisterNavigation = () => {
    setNavigationLabels({});
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
    registerNavigation,
    unregisterNavigation,
    navigationLabels,
    goPrevious,
    goNext,
    skipStep,
    submit,
    canGoPrevious,
    canGoNext,
    isLastStep,
    progressValue,
  };

  const stepIndicator = () => {
    const total = steps().length;
    if (total <= 1) return local.headerActions;
    return (
      <>
        {local.headerActions}
        <span class="text-10 tabular-nums text-content-muted" aria-hidden="true">
          {currentIndex() + 1} / {total}
        </span>
      </>
    );
  };

  return (
    <QuestionnaireContext.Provider value={context}>
      <QuestionnaireFrame
        data-slot="questionnaire"
        class={cn('flex flex-col', local.class)}
        title={local.title ?? 'Questions'}
        leading={local.leading}
        prompt={currentStep()?.title ?? ''}
        detail={currentStep()?.description}
        headerActions={stepIndicator()}
        expanded={local.expanded}
        onExpandedChange={local.onExpandedChange}
        footer={<QuestionnaireFooter />}
        {...rest}
      >
        {local.children}
      </QuestionnaireFrame>
    </QuestionnaireContext.Provider>
  );
};

/** 问卷页脚：上一步 / 跳过 / 下一步·提交（不走页眉 pager，避免与队列导航混淆）。 */
function QuestionnaireFooter() {
  const context = useQuestionnaireContext('QuestionnaireFooter');
  const labels = () => context.navigationLabels();
  const canSkip = () => {
    const step = context.currentStep();
    return !!step && !step.required;
  };

  return (
    <div class="flex w-full items-center gap-8">
      <Show when={context.canGoPrevious()}>
        <button
          type="button"
          class="inline-flex h-(--control-height-sm) items-center px-8 text-12 text-content-muted transition-colors duration-(--duration-fast) hover:text-content-primary"
          onClick={() => context.goPrevious()}
        >
          {labels().previousLabel ?? 'Previous'}
        </button>
      </Show>
      <div class="ml-auto flex items-center gap-8">
        <Show when={canSkip()}>
          <button
            type="button"
            class="inline-flex h-(--control-height-sm) items-center px-8 text-12 text-content-muted transition-colors duration-(--duration-fast) hover:text-content-primary"
            onClick={() => context.skipStep()}
          >
            {labels().skipLabel ?? 'Skip'}
          </button>
        </Show>
        <Button
          type="button"
          size="sm"
          variant="primary"
          class="rounded-full border-0 px-14 focus-visible:shadow-(--shadow-focus-ring)"
          disabled={labels().submitDisabled}
          busy={labels().submitBusy}
          onClick={() => (context.isLastStep() ? context.submit() : context.goNext())}
        >
          {context.isLastStep() ? (labels().submitLabel ?? 'Submit') : (labels().nextLabel ?? 'Next')}
          <CornerDownLeft size={14} strokeWidth={2} class="opacity-90" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

type QuestionnaireStepProps = QuestionnaireStepConfig & {
  class?: string;
};

function DecisionChoiceButton(props: {
  keyLabel: string;
  label: string;
  description?: string;
  selected: boolean;
  multiple?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role={props.multiple ? 'checkbox' : 'radio'}
      aria-checked={props.selected}
      disabled={props.disabled}
      onClick={props.onClick}
      class={cn(
        'flex w-full items-center gap-8 rounded-md px-6 py-6 text-left transition-colors duration-(--duration-fast)',
        props.selected ? 'bg-accent-soft' : 'hover:bg-interaction-hover',
        props.disabled && 'cursor-not-allowed opacity-45',
      )}
    >
      <span
        class={cn(
          'inline-flex size-20 shrink-0 items-center justify-center rounded-sm text-10 font-semibold',
          props.selected
            ? 'bg-accent-solid text-content-on-accent'
            : 'bg-surface-sunken text-content-muted',
        )}
        aria-hidden="true"
      >
        {props.keyLabel}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-12 text-content-primary">{props.label}</span>
        <Show when={props.description}>
          <span class="block truncate text-10 text-content-muted">{props.description}</span>
        </Show>
      </span>
    </button>
  );
}

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

  const toggleMultiple = (value: string) => {
    const current = Array.isArray(answer()) ? [...answer() as string[]] : [];
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    context.setAnswer(local.id, next);
  };

  return (
    <Show when={active()}>
      <div
        data-slot="questionnaire-step"
        data-step-id={local.id}
        class={cn('mt-12 flex min-w-0 flex-col gap-8', local.class)}
        aria-invalid={context.error() ? 'true' : undefined}
        {...rest}
      >
        <Show when={hasChoices() && !local.multiple}>
          <div class="flex flex-col gap-2" role="radiogroup">
            <For each={choices()}>
              {(choice, index) => (
                <DecisionChoiceButton
                  keyLabel={choiceKey(index())}
                  label={choice.label}
                  description={choice.description}
                  selected={answer() === choice.value}
                  disabled={choice.disabled}
                  onClick={() => context.setAnswer(local.id, choice.value)}
                />
              )}
            </For>
          </div>
        </Show>

        <Show when={hasChoices() && local.multiple}>
          <div class="flex flex-col gap-2">
            <For each={choices()}>
              {(choice, index) => {
                const selected = () => Array.isArray(answer()) && (answer() as string[]).includes(choice.value);
                return (
                  <DecisionChoiceButton
                    keyLabel={choiceKey(index())}
                    label={choice.label}
                    description={choice.description}
                    selected={selected()}
                    multiple
                    disabled={choice.disabled}
                    onClick={() => toggleMultiple(choice.value)}
                  />
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
      </div>
    </Show>
  );
};

/** 问卷进度条（多步时显示在步骤内容上方）。 */
export const QuestionnaireProgress: Component<{ class?: string; 'aria-label'?: string }> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'aria-label']);
  const context = useQuestionnaireContext('QuestionnaireProgress');
  const label = () => local['aria-label'] ?? 'Questionnaire progress';

  return (
    <Show when={context.steps().length > 1}>
      <Progress
        value={context.progressValue()}
        aria-label={label()}
        data-slot="questionnaire-progress"
        class={cn('mt-12 w-full', local.class)}
        {...rest}
      >
        <ProgressTrack>
          <ProgressFill />
        </ProgressTrack>
      </Progress>
    </Show>
  );
};

type QuestionnaireNavigationProps = {
  class?: string;
  previousLabel?: string;
  nextLabel?: string;
  skipLabel?: string;
  submitLabel?: string;
  submitDisabled?: boolean;
  submitBusy?: boolean;
};

/** 注册问卷导航文案；按钮由 QuestionnaireFooter 渲染。 */
export const QuestionnaireNavigation: Component<QuestionnaireNavigationProps> = (props) => {
  const [local] = splitProps(props, [
    'class',
    'previousLabel',
    'nextLabel',
    'skipLabel',
    'submitLabel',
    'submitDisabled',
    'submitBusy',
  ]);
  const context = useQuestionnaireContext('QuestionnaireNavigation');

  createEffect(() => {
    context.registerNavigation({
      previousLabel: local.previousLabel,
      nextLabel: local.nextLabel,
      skipLabel: local.skipLabel,
      submitLabel: local.submitLabel,
      submitDisabled: local.submitDisabled,
      submitBusy: local.submitBusy,
    });
  });
  onCleanup(() => context.unregisterNavigation());

  return null;
};
