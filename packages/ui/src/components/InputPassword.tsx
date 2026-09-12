import { Eye, EyeOff } from 'lucide-solid';
import { createSignal, splitProps, type Component } from 'solid-js';
import { cn } from '../lib/cn';
import { IconButton } from './Button';
import { Input, type InputProps } from './Field';

export type InputPasswordProps = Omit<InputProps, 'type' | 'suffix'>;

/** 密码输入：可切换明文/密文。 */
export const InputPassword: Component<InputPasswordProps> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  const [visible, setVisible] = createSignal(false);

  return (
    <Input
      {...rest}
      type={visible() ? 'text' : 'password'}
      class={cn(local.class)}
      suffix={
        <IconButton
          type="button"
          label={visible() ? 'Hide password' : 'Show password'}
          showTooltip={false}
          size="sm"
          variant="ghost"
          class="text-content-muted"
          onClick={() => setVisible((value) => !value)}
        >
          {visible() ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </IconButton>
      }
    />
  );
};
