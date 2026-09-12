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

/** T4 装配：Composer 悬浮锚点容器（BackToTop 绝对定位参照）。 */
export const chatFloatingAnchorClass =
  'relative z-2 shrink-0';

const shellClass =
  'ui-chat-column pointer-events-none absolute inset-x-0 bottom-full z-10 mb-12 flex justify-center transition-[opacity,transform,visibility] duration-base ease-standard data-[visible=false]:invisible data-[visible=false]:translate-y-4 data-[visible=false]:opacity-0 data-[visible=true]:visible data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100';

const buttonClass =
  'inline-flex h-28 cursor-pointer items-center justify-center gap-6 rounded-full border border-border-strong bg-surface-overlay px-12 text-12 font-medium leading-snug whitespace-nowrap text-content-secondary shadow-overlay outline-none pointer-events-auto hover:border-border-strong hover:bg-surface-overlay hover:text-content-secondary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2';

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
      class={cn(shellClass, 'mx-auto w-full max-w-(--chat-content-max)', local.class)}
      {...rest}
    >
      <button
        type="button"
        class={buttonClass}
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
              class={cn('shrink-0 text-content-muted', direction() === 'start' && 'rotate-180')}
              aria-hidden="true"
            />
            <span>{label()}</span>
          </>
        )}
      </button>
    </div>
  );
};
