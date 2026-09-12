import { ArrowDown } from 'lucide-solid';
import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';

export type BackToTopProps = ComponentProps<'div'> & {
  /** 为 false 时淡出并禁用交互。 */
  visible?: boolean;
  /** 按钮文案；默认随 direction 为 “Back to latest” / “Back to top”。 */
  label?: string;
  onClick?: () => void;
  /** end = 回到底部最新消息（聊天默认）；start = 回到顶部。 */
  direction?: 'start' | 'end';
};

/** T2 · 滚动回锚点：贴于 composer 等贴底区正上方，由 T4 注入 visible 与 onClick。 */
export const BackToTop: Component<BackToTopProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'visible',
    'label',
    'onClick',
    'direction',
    'children',
  ]);
  const direction = () => local.direction ?? 'end';
  const visible = () => local.visible ?? false;
  const label = () =>
    local.label ?? (direction() === 'end' ? 'Back to latest' : 'Back to top');

  return (
    <div
      data-slot="back-to-top"
      data-visible={visible() ? 'true' : 'false'}
      data-direction={direction()}
      class={cn('ui-back-to-top ui-chat-column mx-auto w-full max-w-(--chat-content-max)', local.class)}
      {...rest}
    >
      <button
        type="button"
        class="ui-back-to-top__button"
        aria-hidden={visible() ? undefined : true}
        inert={visible() ? undefined : true}
        tabIndex={visible() ? 0 : -1}
        onClick={local.onClick}
      >
        {local.children ?? (
          <>
            <ArrowDown
              size={14}
              strokeWidth={1.7}
              class={cn('ui-back-to-top__icon shrink-0', direction() === 'start' && 'rotate-180')}
              aria-hidden="true"
            />
            <span class="ui-back-to-top__label">{label()}</span>
          </>
        )}
      </button>
    </div>
  );
};
