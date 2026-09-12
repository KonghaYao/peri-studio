import { ComponentCatalogExtras } from '@/pages/ComponentCatalogExtras';
import { ComponentCatalogExtrasB } from '@/pages/ComponentCatalogExtrasB';
import { ComponentCatalogExtrasC } from '@/pages/ComponentCatalogExtrasC';
import { ComponentCatalogExtrasD } from '@/pages/ComponentCatalogExtrasD';
import { ComponentCatalogExtrasE } from '@/pages/ComponentCatalogExtrasE';
import { ComponentCatalogExtrasG } from '@/pages/ComponentCatalogExtrasG';
import { ComponentCatalogExtrasForms2 } from '@/pages/ComponentCatalogExtrasForms2';
import { ComponentCatalogFeedback } from '@/pages/ComponentCatalogFeedback';
import { TierHeader } from '@/pages/shared/DemoSection';

/** T2 · 表单与输入：开关、组合输入、日期、Field、DataTable、Questionnaire 等。 */
export function ComponentsFormsPage() {
  return (
    <div class="mx-auto max-w-4xl">
      <TierHeader
        tier="Tier 2 · Forms"
        title="Forms & input"
        description="表单控件、组合输入、日期选择、Field 布局与数据表/问卷流。"
      />
      <ComponentCatalogExtras sections={['switch']} />
      <ComponentCatalogExtrasB sections={['input-group']} />
      <ComponentCatalogExtrasC sections={['combobox', 'typography', 'resizable']} />
      <ComponentCatalogExtrasD sections={['calendar', 'date-picker', 'form']} />
      <ComponentCatalogExtrasE sections={['field']} />
      <ComponentCatalogExtrasG sections={['data-table', 'questionnaire-option-row', 'questionnaire']} />
      <ComponentCatalogExtrasForms2
        sections={[
          'input-variants',
          'input-number',
          'auto-complete',
          'cascader',
          'color-picker',
          'mentions',
          'rate',
          'time-picker',
          'date-range-picker',
          'transfer',
          'tree-select',
          'select-enhanced',
          'checkbox-radio-switch',
        ]}
      />
      <ComponentCatalogFeedback sections={['enhanced-table']} />
    </div>
  );
}
