import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  AutoComplete,
  Cascader,
  Checkbox,
  CheckboxControl,
  CheckboxInput,
  CheckboxLabel,
  ColorPicker,
  DateRangePicker,
  Input,
  InputNumber,
  Mentions,
  RadioButton,
  RadioGroup,
  Rate,
  Select,
  Switch,
  SwitchControl,
  SwitchInput,
  SwitchThumb,
  TimePicker,
  TimeRangePicker,
  Transfer,
  TreeSelect,
} from '@peri/ui';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

const cascaderOptions = [
  {
    value: 'zhejiang',
    label: 'Zhejiang',
    children: [
      { value: 'hangzhou', label: 'Hangzhou' },
      { value: 'ningbo', label: 'Ningbo' },
    ],
  },
  {
    value: 'jiangsu',
    label: 'Jiangsu',
    children: [{ value: 'nanjing', label: 'Nanjing' }],
  },
];

const treeData = [
  {
    value: 'docs',
    title: 'Docs',
    children: [
      { value: 'guide', title: 'Guide' },
      { value: 'api', title: 'API' },
    ],
  },
];

const virtualSelectOptions = Array.from({ length: 200 }, (_, index) => ({
  value: `model-${index}`,
  label: `Model ${index + 1}`,
}));

const transferData = [
  { key: 'read', title: 'Read tool', description: 'Filesystem read' },
  { key: 'write', title: 'Write tool', description: 'Filesystem write' },
  { key: 'grep', title: 'Grep tool', description: 'Pattern search' },
];

/** T2 · Ant Design 对齐的数据录入组件（第二批）。 */
export function ComponentCatalogExtrasForms2(props: { sections?: string[] }) {
  const [rate, setRate] = createSignal(3);
  const [color, setColor] = createSignal('#1677ff');
  const [number, setNumber] = createSignal(12);
  const [mention, setMention] = createSignal('');
  const [autoValue, setAutoValue] = createSignal('');
  const [region, setRegion] = createSignal<string[]>([]);
  const [treeValue, setTreeValue] = createSignal<string[]>([]);
  const [targetKeys, setTargetKeys] = createSignal<string[]>(['write']);
  const [multiSelect, setMultiSelect] = createSignal<string[]>(['gpt-4']);
  const [radio, setRadio] = createSignal('a');
  const [indeterminate, setIndeterminate] = createSignal(true);
  const [checkedList, setCheckedList] = createSignal(['read']);
  const [switchLoading, setSwitchLoading] = createSignal(true);

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'input-variants')}>
        <CatalogDemo id="input-variants" title="Input variants" description="Password、Search、allowClear、prefix/suffix、showCount、尺寸与变体。">
          <DemoRow label="Password & Search">
            <Input.Password placeholder="Password" class="max-w-sm" />
            <Input.Search placeholder="Search sessions" class="max-w-sm" enterButton onSearch={(value) => console.log(value)} />
          </DemoRow>
          <DemoRow label="Sizes & variants">
            <Input size="sm" placeholder="Small" class="max-w-xs" allowClear />
            <Input size="md" variant="filled" placeholder="Filled" class="max-w-xs" prefix="$" />
            <Input size="lg" variant="borderless" placeholder="Borderless" class="max-w-xs" showCount maxLength={40} />
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'input-number')}>
        <CatalogDemo id="input-number" title="InputNumber" description="步进、min/max、spinner 控制。">
          <InputNumber value={number()} onChange={(value) => setNumber(value ?? 0)} min={0} max={100} step={2} class="max-w-xs" />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'auto-complete')}>
        <CatalogDemo id="auto-complete" title="AutoComplete" description="输入建议下拉。">
          <AutoComplete
            class="max-w-sm"
            value={autoValue()}
            onChange={setAutoValue}
            options={[
              { value: 'burnout', label: 'Burnout' },
              { value: 'burnished', label: 'Burnished bronze' },
              { value: 'burning', label: 'Burning daylight' },
            ]}
            placeholder="Type to search"
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'cascader')}>
        <CatalogDemo id="cascader" title="Cascader" description="级联区域选择。">
          <Cascader class="max-w-sm" options={cascaderOptions} value={region()} onChange={(value) => setRegion(value)} placeholder="Select region" />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'color-picker')}>
        <CatalogDemo id="color-picker" title="ColorPicker" description="预设色板 + hex 输入。">
          <ColorPicker value={color()} onChange={setColor} showText />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'mentions')}>
        <CatalogDemo id="mentions" title="Mentions" description="@ 提及建议。">
          <Mentions
            class="max-w-md"
            value={mention()}
            onChange={setMention}
            options={[
              { value: 'alice', label: 'Alice' },
              { value: 'bob', label: 'Bob' },
            ]}
            placeholder="Mention a teammate"
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'rate')}>
        <CatalogDemo id="rate" title="Rate" description="星级评分。">
          <Rate value={rate()} onChange={setRate} allowHalf tooltips={['Bad', 'Poor', 'OK', 'Good', 'Great']} />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'time-picker')}>
        <CatalogDemo id="time-picker" title="TimePicker" description="时间选择与范围。">
          <TimePicker placeholder="Pick time" />
          <TimeRangePicker showSecond />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'date-range-picker')}>
        <CatalogDemo id="date-range-picker" title="DatePicker.RangePicker" description="开始/结束日期组合。">
          <DateRangePicker placeholder={['Start', 'End']} />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'transfer')}>
        <CatalogDemo id="transfer" title="Transfer" description="穿梭框列表。">
          <Transfer
            dataSource={transferData}
            targetKeys={targetKeys()}
            onChange={setTargetKeys}
            showSearch
            titles={['Available tools', 'Enabled tools']}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'tree-select')}>
        <CatalogDemo id="tree-select" title="TreeSelect" description="树形下拉多选。">
          <TreeSelect
            class="max-w-sm"
            treeData={treeData}
            value={treeValue()}
            onChange={(value) => setTreeValue(Array.isArray(value) ? value : [value])}
            multiple
            treeCheckable
            showSearch
            placeholder="Select docs"
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'select-enhanced')}>
        <CatalogDemo id="select-enhanced" title="Select enhancements" description="多选、清除、分组、状态。">
          <Select
            class="max-w-sm"
            mode="multiple"
            allowClear
            showSearch
            value={multiSelect()}
            onChange={setMultiSelect}
            optionGroups={[
              {
                label: 'OpenAI',
                options: [
                  { value: 'gpt-4', label: 'GPT-4' },
                  { value: 'gpt-4o', label: 'GPT-4o' },
                ],
              },
              {
                label: 'Anthropic',
                options: [{ value: 'claude', label: 'Claude' }],
              },
            ]}
            placeholder="Models"
          />
          <Select
            class="max-w-sm"
            status="warning"
            loading
            options={[{ value: 'one', label: 'Loading state' }]}
            placeholder="Loading"
          />
          <Select
            class="max-w-sm"
            virtualScroll
            showSearch
            options={virtualSelectOptions}
            placeholder="Virtual scroll (200 items)"
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'checkbox-radio-switch')}>
        <CatalogDemo id="checkbox-radio-switch" title="Checkbox · Radio · Switch" description="半选、按钮样式、开关文案与 loading。">
          <Checkbox
            indeterminate={indeterminate()}
            checked={checkedList().length === 2}
            onChange={(checked) => {
              setIndeterminate(false);
              setCheckedList(checked ? ['read', 'write'] : []);
            }}
            class="inline-flex items-center gap-8"
          >
            <CheckboxInput />
            <CheckboxControl indeterminate={indeterminate()} />
            <CheckboxLabel>Check all tools</CheckboxLabel>
          </Checkbox>
          <RadioGroup value={radio()} onChange={setRadio} class="inline-flex">
            <RadioButton value="a" position="start">List</RadioButton>
            <RadioButton value="b" position="middle">Kanban</RadioButton>
            <RadioButton value="c" position="end">Timeline</RadioButton>
          </RadioGroup>
          <Switch checked={switchLoading()} onChange={setSwitchLoading} class="inline-flex items-center gap-8">
            <SwitchInput />
            <SwitchControl loading={switchLoading()} checkedChildren="ON" unCheckedChildren="OFF">
              <SwitchThumb />
            </SwitchControl>
          </Switch>
        </CatalogDemo>
      </Show>
    </>
  );
}
