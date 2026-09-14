import { createMemo, splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { Select, type SelectOption } from '../Select';

/** 内部 ALL 哨兵；对应 peri-fuse `filter-select.tsx` 的 `__all__`。 */
export const FILTER_SELECT_ALL = '__all__';

export type FilterSelectOption = {
  value: string;
  label: string;
};

export type FilterSelectProps = {
  /** 已提交值（undefined = All）。 */
  value: string | undefined;
  /** 选择后立即提交；ALL 提交 undefined。 */
  onCommit: (value: string | undefined) => void;
  placeholder?: string;
  /** “All xxx” 选项文案，例如 "All types"。 */
  allLabel: string;
  options: FilterSelectOption[];
  class?: string;
  title?: string;
  'aria-label'?: string;
};

/**
 * 检索栏选择筛选：`__all__` 哨兵 + undefined 提交。
 * 对应 peri-fuse `filter-select.tsx`。
 */
export const FilterSelect: Component<FilterSelectProps> = (props) => {
  const [local] = splitProps(props, [
    'value',
    'onCommit',
    'placeholder',
    'allLabel',
    'options',
    'class',
    'title',
    'aria-label',
  ]);

  const selectOptions = createMemo<SelectOption[]>(() => [
    { value: FILTER_SELECT_ALL, label: local.allLabel },
    ...local.options,
  ]);

  return (
    <Select
      value={local.value ?? FILTER_SELECT_ALL}
      options={selectOptions()}
      placeholder={local.placeholder}
      aria-label={local['aria-label'] ?? local.title}
      class={cn('h-28 w-(--container-menu-min)', local.class)}
      onChange={(next) => local.onCommit(next !== FILTER_SELECT_ALL ? next : undefined)}
    />
  );
};
