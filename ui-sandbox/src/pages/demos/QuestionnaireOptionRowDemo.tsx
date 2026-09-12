import { createSignal } from 'solid-js';
import {
  QuestionnaireCheckboxOption,
  QuestionnaireRadioOption,
  questionnaireOptionListClass,
  RadioGroup,
} from '@peri/ui';
import { DemoRow } from '@/pages/shared/DemoSection';

/** T2 问卷选项行：键位徽章 + 文案 + 单选/多选控件。 */
export function QuestionnaireOptionRowDemo() {
  const [radioValue, setRadioValue] = createSignal('safe');
  const [docsChecked, setDocsChecked] = createSignal(true);
  const [testsChecked, setTestsChecked] = createSignal(false);

  return (
    <div class="max-w-md space-y-16">
      <DemoRow label="Radio options">
        <RadioGroup
          class={questionnaireOptionListClass()}
          value={radioValue()}
          onChange={setRadioValue}
        >
          <QuestionnaireRadioOption
            value="safe"
            index={0}
            label="Safe mode"
            description="Fewer side effects"
          />
          <QuestionnaireRadioOption
            value="fast"
            index={1}
            label="Fast mode"
            description="More parallelism"
          />
        </RadioGroup>
      </DemoRow>
      <DemoRow label="Checkbox options">
        <div class={questionnaireOptionListClass()}>
          <QuestionnaireCheckboxOption
            checked={docsChecked()}
            index={0}
            label="Update docs"
            description="Refresh README and architecture notes"
            onChange={setDocsChecked}
          />
          <QuestionnaireCheckboxOption
            checked={testsChecked()}
            index={1}
            label="Run tests"
            description="Execute web and Rust test suites"
            onChange={setTestsChecked}
          />
        </div>
      </DemoRow>
    </div>
  );
}
