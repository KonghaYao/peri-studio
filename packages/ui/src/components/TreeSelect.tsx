import { ChevronDown, ChevronRight } from 'lucide-solid';
import {
  For,
  Show,
  createMemo,
  createSignal,
  splitProps,
  type Component,
} from 'solid-js';
import { cn } from '../lib/cn';
import { inputShellClass } from '../lib/input-variants';
import type { InputShellVariantProps } from '../lib/input-variants';
import { Checkbox, CheckboxControl, CheckboxInput } from './Checkbox';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export type TreeSelectNode = {
  value: string;
  title: string;
  disabled?: boolean;
  children?: TreeSelectNode[];
};

export type TreeSelectProps = InputShellVariantProps & {
  treeData: TreeSelectNode[];
  value?: string | string[];
  defaultValue?: string | string[];
  onChange?: (value: string | string[]) => void;
  multiple?: boolean;
  treeCheckable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  showSearch?: boolean;
  class?: string;
  treeDefaultExpandAll?: boolean;
  'data-testid'?: string;
};

function flattenTree(nodes: TreeSelectNode[]): TreeSelectNode[] {
  const result: TreeSelectNode[] = [];
  const walk = (items: TreeSelectNode[]) => {
    for (const item of items) {
      result.push(item);
      if (item.children?.length) walk(item.children);
    }
  };
  walk(nodes);
  return result;
}

function findNode(nodes: TreeSelectNode[], value: string): TreeSelectNode | undefined {
  for (const node of nodes) {
    if (node.value === value) return node;
    const child = node.children ? findNode(node.children, value) : undefined;
    if (child) return child;
  }
  return undefined;
}

/** 树形选择：下拉树列表，支持单选/多选。 */
export const TreeSelect: Component<TreeSelectProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'treeData',
    'value',
    'defaultValue',
    'onChange',
    'multiple',
    'treeCheckable',
    'placeholder',
    'disabled',
    'allowClear',
    'showSearch',
    'class',
    'size',
    'variant',
    'status',
    'treeDefaultExpandAll',
    'data-testid',
  ]);

  const [internal, setInternal] = createSignal<string | string[]>(
    local.defaultValue ?? (local.multiple ? [] : ''),
  );
  const [open, setOpen] = createSignal(false);
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [query, setQuery] = createSignal('');

  const value = createMemo(() => local.value ?? internal());
  const multiple = () => local.multiple ?? local.treeCheckable ?? false;

  const selectedValues = createMemo(() => {
    const current = value();
    return Array.isArray(current) ? current : current ? [current] : [];
  });

  const label = createMemo(() => {
    const values = selectedValues();
    if (values.length === 0) return local.placeholder ?? 'Select';
    const labels = values
      .map((item) => findNode(local.treeData, item)?.title)
      .filter(Boolean);
    return labels.join(', ');
  });

  const commit = (next: string | string[]) => {
    if (local.value === undefined) setInternal(next);
    local.onChange?.(next);
  };

  const toggleExpand = (valueKey: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(valueKey)) next.delete(valueKey);
      else next.add(valueKey);
      return next;
    });
  };

  const toggleSelect = (node: TreeSelectNode) => {
    if (node.disabled) return;
    if (multiple()) {
      const current = selectedValues();
      const next = current.includes(node.value)
        ? current.filter((item) => item !== node.value)
        : [...current, node.value];
      commit(next);
      return;
    }
    commit(node.value);
    setOpen(false);
  };

  const filteredTree = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q || !local.showSearch) return local.treeData;
    const allowed = new Set(
      flattenTree(local.treeData)
        .filter((node) => node.title.toLowerCase().includes(q))
        .map((node) => node.value),
    );
    const prune = (nodes: TreeSelectNode[]): TreeSelectNode[] =>
      nodes
        .map((node) => ({
          ...node,
          children: node.children ? prune(node.children) : undefined,
        }))
        .filter((node) => allowed.has(node.value) || (node.children?.length ?? 0) > 0);
    return prune(local.treeData);
  });

  return (
    <Popover open={open()} onOpenChange={setOpen}>
      <PopoverTrigger
        as="button"
        type="button"
        disabled={local.disabled}
        data-testid={local['data-testid']}
        class={inputShellClass({
          size: local.size,
          variant: local.variant,
          status: local.status,
          class: cn('justify-between text-left', local.class),
        })}
        {...rest}
      >
        <span class={cn('min-w-0 truncate', selectedValues().length === 0 && 'text-text-faint')}>
          {label()}
        </span>
        <ChevronDown size={14} class="shrink-0 text-content-muted" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent class="w-(--container-menu-min) p-8">
        <Show when={local.showSearch}>
          <input
            class="mb-8 h-32 w-full rounded-6 border border-border-strong bg-surface px-10 text-13 outline-none focus:border-focus-ring"
            placeholder="Search"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </Show>
        <TreeSelectList
          nodes={filteredTree()}
          depth={0}
          expanded={expanded()}
          selected={selectedValues()}
          multiple={multiple()}
          checkable={local.treeCheckable ?? false}
          defaultExpandAll={local.treeDefaultExpandAll ?? false}
          onToggleExpand={toggleExpand}
          onSelect={toggleSelect}
        />
      </PopoverContent>
    </Popover>
  );
};

function TreeSelectList(props: {
  nodes: TreeSelectNode[];
  depth: number;
  expanded: Set<string>;
  selected: string[];
  multiple: boolean;
  checkable: boolean;
  defaultExpandAll: boolean;
  onToggleExpand: (value: string) => void;
  onSelect: (node: TreeSelectNode) => void;
}) {
  return (
    <For each={props.nodes}>
      {(node) => {
        const hasChildren = () => (node.children?.length ?? 0) > 0;
        const isExpanded = () => props.defaultExpandAll || props.expanded.has(node.value);
        const isSelected = () => props.selected.includes(node.value);
        return (
          <div>
            <div
              class={cn(
                'flex min-h-32 items-center gap-6 rounded-6 px-8 py-4 hover:bg-interaction-hover',
                isSelected() && 'bg-interaction-hover',
              )}
              style={{ 'padding-left': `${props.depth * 12 + 8}px` }}
            >
              <Show when={hasChildren()}>
                <button
                  type="button"
                  class="grid size-20 place-items-center text-content-muted"
                  onClick={() => props.onToggleExpand(node.value)}
                  aria-label={isExpanded() ? 'Collapse' : 'Expand'}
                >
                  {isExpanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </Show>
              <Show when={!hasChildren()}>
                <span class="size-20" aria-hidden="true" />
              </Show>
              <Show
                when={props.checkable || props.multiple}
                fallback={
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left text-13 text-content-primary disabled:opacity-45"
                    disabled={node.disabled}
                    onClick={() => props.onSelect(node)}
                  >
                    {node.title}
                  </button>
                }
              >
                <Checkbox
                  checked={isSelected()}
                  disabled={node.disabled}
                  onChange={() => props.onSelect(node)}
                  class="flex min-w-0 flex-1 items-center gap-8"
                >
                  <CheckboxInput />
                  <CheckboxControl />
                  <span class="truncate text-13 text-content-primary">{node.title}</span>
                </Checkbox>
              </Show>
            </div>
            <Show when={hasChildren() && isExpanded()}>
              <TreeSelectList
                nodes={node.children!}
                depth={props.depth + 1}
                expanded={props.expanded}
                selected={props.selected}
                multiple={props.multiple}
                checkable={props.checkable}
                defaultExpandAll={props.defaultExpandAll}
                onToggleExpand={props.onToggleExpand}
                onSelect={props.onSelect}
              />
            </Show>
          </div>
        );
      }}
    </For>
  );
}
