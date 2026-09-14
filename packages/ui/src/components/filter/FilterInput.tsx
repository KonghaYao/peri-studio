import { Search, X, type LucideIcon } from 'lucide-solid';
import {
  Show,
  createEffect,
  createSignal,
  onMount,
  splitProps,
  type Component,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../../lib/cn';
import { IconButton } from '../Button';
import { Input } from '../Field';

/** 供筛选栏 Search 按钮触发提交（等价按 Enter）。对应 peri-fuse `FilterInputHandle`。 */
export type FilterInputHandle = {
  commit: () => void;
};

export type FilterInputProps = {
  /** 已提交值（undefined = 未激活）。 */
  value: string | undefined;
  /** Enter / clear / 外部 commit 时回调；空字符串提交为 undefined。 */
  onCommit: (value: string | undefined) => void;
  icon?: LucideIcon;
  placeholder?: string;
  class?: string;
  title?: string;
  'aria-label'?: string;
  ref?: (handle: FilterInputHandle) => void;
};

/**
 * 检索栏文本筛选：draft 与已提交 value 分离；Enter 提交、Escape 回滚、clear 清空。
 * 对应 peri-fuse `filter-input.tsx`。
 */
export const FilterInput: Component<FilterInputProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'value',
    'onCommit',
    'icon',
    'placeholder',
    'class',
    'title',
    'aria-label',
    'ref',
  ]);

  const Icon = () => local.icon ?? Search;
  const [draft, setDraft] = createSignal(local.value ?? '');

  createEffect(() => {
    setDraft(local.value ?? '');
  });

  const commitDraft = (raw: string) => {
    const trimmed = raw.trim();
    local.onCommit(trimmed === '' ? undefined : trimmed);
  };

  onMount(() => {
    local.ref?.({
      commit: () => commitDraft(draft()),
    });
  });

  return (
    <div class={cn('relative w-full', local.class)}>
      <Input
        {...rest}
        size="sm"
        title={local.title}
        aria-label={local['aria-label'] ?? local.title}
        placeholder={local.placeholder}
        value={draft()}
        prefix={(
          <Dynamic
            component={Icon()}
            size={14}
            class="text-content-muted"
            aria-hidden="true"
          />
        )}
        suffix={(
          <Show when={draft().length > 0}>
            <IconButton
              type="button"
              label={`Clear ${local.placeholder ?? 'filter'}`}
              showTooltip={false}
              size="sm"
              variant="ghost"
              class="shrink-0 text-content-muted"
              onClick={() => {
                setDraft('');
                local.onCommit(undefined);
              }}
            >
              <X size={14} aria-hidden="true" />
            </IconButton>
          </Show>
        )}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitDraft(event.currentTarget.value);
          }
          if (event.key === 'Escape') {
            setDraft(local.value ?? '');
          }
        }}
      />
    </div>
  );
};
