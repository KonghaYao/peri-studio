import { Search } from 'lucide-solid';
import { splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { IconButton } from './Button';
import { Input, type InputProps } from './Field';

export type InputSearchProps = InputProps & {
  onSearch?: (value: string, event?: KeyboardEvent | MouseEvent) => void;
  enterButton?: boolean | string;
};

/** 搜索输入：Enter 或按钮触发 onSearch。 */
export const InputSearch: Component<InputSearchProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'onSearch', 'enterButton', 'onKeyDown']);

  const suffix = () => {
    if (local.enterButton) {
      const label = typeof local.enterButton === 'string' ? local.enterButton : 'Search';
      return (
        <IconButton
          type="button"
          label={label}
          showTooltip={false}
          size="sm"
          variant="primary"
          onClick={(event) => {
            const root = (event.currentTarget as HTMLElement).closest('[data-slot="input-shell"]');
            const input = root?.querySelector('input') as HTMLInputElement | null;
            local.onSearch?.(input?.value ?? '', event);
          }}
        >
          {typeof local.enterButton === 'string' ? local.enterButton : <Search size={14} aria-hidden="true" />}
        </IconButton>
      );
    }
    return <Search size={14} class="text-content-muted" aria-hidden="true" />;
  };

  return (
    <div data-slot="input-shell" class={cn('w-full', local.class)}>
      <Input
        {...rest}
        prefix={<Search size={14} class="text-content-muted" aria-hidden="true" />}
        suffix={suffix()}
        onKeyDown={(event) => {
          if (typeof local.onKeyDown === 'function') local.onKeyDown(event);
          if (event.key === 'Enter') {
            const input = event.currentTarget as HTMLInputElement;
            local.onSearch?.(input.value, event);
          }
        }}
      />
    </div>
  );
};
