import { ChevronLeft, ChevronRight } from 'lucide-solid';
import {
  For,
  Show,
  createMemo,
  createSignal,
  splitProps,
  type Component,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Checkbox, CheckboxControl, CheckboxInput, CheckboxLabel } from './Checkbox';
import { InputSearch } from './InputSearch';

export type TransferItem = {
  key: string;
  title: string;
  description?: string;
  disabled?: boolean;
};

export type TransferProps = {
  dataSource: TransferItem[];
  targetKeys?: string[];
  defaultTargetKeys?: string[];
  onChange?: (targetKeys: string[], direction: 'left' | 'right', moveKeys: string[]) => void;
  titles?: [JSX.Element, JSX.Element];
  showSearch?: boolean;
  disabled?: boolean;
  class?: string;
  listStyle?: { width?: number; height?: number };
  render?: (item: TransferItem) => JSX.Element;
  'data-testid'?: string;
};

/** 穿梭框：左右列表移动条目。 */
export const Transfer: Component<TransferProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'dataSource',
    'targetKeys',
    'defaultTargetKeys',
    'onChange',
    'titles',
    'showSearch',
    'disabled',
    'class',
    'listStyle',
    'render',
    'data-testid',
  ]);

  const [internalTarget, setInternalTarget] = createSignal<string[]>(local.defaultTargetKeys ?? []);
  const [leftChecked, setLeftChecked] = createSignal<string[]>([]);
  const [rightChecked, setRightChecked] = createSignal<string[]>([]);
  const [leftQuery, setLeftQuery] = createSignal('');
  const [rightQuery, setRightQuery] = createSignal('');

  const targetKeys = createMemo(() => local.targetKeys ?? internalTarget());
  const sourceItems = createMemo(() =>
    local.dataSource.filter((item) => !targetKeys().includes(item.key)),
  );
  const targetItems = createMemo(() =>
    local.dataSource.filter((item) => targetKeys().includes(item.key)),
  );

  const filterItems = (items: TransferItem[], query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      item.title.toLowerCase().includes(q)
      || item.description?.toLowerCase().includes(q),
    );
  };

  const move = (direction: 'left' | 'right', keys: string[]) => {
    if (keys.length === 0) return;
    const next = direction === 'right'
      ? [...targetKeys(), ...keys]
      : targetKeys().filter((key) => !keys.includes(key));
    if (local.targetKeys === undefined) setInternalTarget(next);
    local.onChange?.(next, direction, keys);
    if (direction === 'right') setLeftChecked([]);
    else setRightChecked([]);
  };

  const titles = () => local.titles ?? ['Source', 'Target'];

  return (
    <div
      data-testid={local['data-testid']}
      class={cn('flex items-stretch gap-12', local.class)}
      {...rest}
    >
      <TransferPanel
        title={titles()[0]}
        items={filterItems(sourceItems(), leftQuery())}
        checked={leftChecked()}
        onCheckedChange={setLeftChecked}
        disabled={local.disabled}
        showSearch={local.showSearch}
        query={leftQuery()}
        onQueryChange={setLeftQuery}
        listStyle={local.listStyle}
        render={local.render}
      />
      <div class="flex flex-col justify-center gap-8">
        <Button
          variant="default"
          size="sm"
          disabled={local.disabled || leftChecked().length === 0}
          onClick={() => move('right', leftChecked())}
          aria-label="Move to right"
        >
          <ChevronRight size={14} aria-hidden="true" />
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={local.disabled || rightChecked().length === 0}
          onClick={() => move('left', rightChecked())}
          aria-label="Move to left"
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </Button>
      </div>
      <TransferPanel
        title={titles()[1]}
        items={filterItems(targetItems(), rightQuery())}
        checked={rightChecked()}
        onCheckedChange={setRightChecked}
        disabled={local.disabled}
        showSearch={local.showSearch}
        query={rightQuery()}
        onQueryChange={setRightQuery}
        listStyle={local.listStyle}
        render={local.render}
      />
    </div>
  );
};

function TransferPanel(props: {
  title: JSX.Element;
  items: TransferItem[];
  checked: string[];
  onCheckedChange: (keys: string[]) => void;
  disabled?: boolean;
  showSearch?: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  listStyle?: { width?: number; height?: number };
  render?: (item: TransferItem) => JSX.Element;
}) {
  const toggle = (key: string, next: boolean) => {
    props.onCheckedChange(
      next ? [...props.checked, key] : props.checked.filter((value) => value !== key),
    );
  };

  return (
    <div
      class="flex min-w-56 flex-col rounded-8 border border-border-subtle bg-surface"
      style={{
        width: props.listStyle?.width ? `${props.listStyle.width}px` : undefined,
        height: props.listStyle?.height ? `${props.listStyle.height}px` : undefined,
      }}
    >
      <div class="border-b border-border-subtle px-12 py-8 text-13 font-medium text-content-primary">
        {props.title}
        <span class="ml-6 text-12 font-normal text-content-muted">({props.items.length})</span>
      </div>
      <Show when={props.showSearch}>
        <div class="border-b border-border-subtle p-8">
          <InputSearch
            value={props.query}
            onInput={(event) => props.onQueryChange(event.currentTarget.value)}
            placeholder="Search"
            size="sm"
          />
        </div>
      </Show>
      <div class="flex-1 overflow-y-auto p-4">
        <For each={props.items}>
          {(item) => (
            <Checkbox
              checked={props.checked.includes(item.key)}
              disabled={props.disabled || item.disabled}
              onChange={(checked) => toggle(item.key, checked)}
              class="flex min-h-32 items-start gap-8 rounded-6 px-8 py-6 hover:bg-interaction-hover"
            >
              <CheckboxInput />
              <CheckboxControl />
              <CheckboxLabel class="min-w-0">
                {props.render?.(item) ?? (
                  <div class="flex flex-col">
                    <span class="text-13 text-content-primary">{item.title}</span>
                    <Show when={item.description}>
                      <span class="text-11 text-content-muted">{item.description}</span>
                    </Show>
                  </div>
                )}
              </CheckboxLabel>
            </Checkbox>
          )}
        </For>
      </div>
    </div>
  );
}
