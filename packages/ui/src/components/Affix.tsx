import {
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  type Component,
  type ComponentProps,
  type JSX,
} from 'solid-js';
import { cn } from '../lib/cn';

type AffixTarget = () => Window | HTMLElement | null;

export type AffixProps = ComponentProps<'div'> & {
  offsetTop?: number;
  offsetBottom?: number;
  target?: AffixTarget;
  onChange?: (affixed: boolean) => void;
};

function getScrollTop(target: Window | HTMLElement): number {
  if (target === window) {
    return window.scrollY || document.documentElement.scrollTop;
  }
  return (target as HTMLElement).scrollTop;
}

function getTargetRect(target: Window | HTMLElement, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (target === window) {
    return {
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height,
    };
  }
  const containerRect = (target as HTMLElement).getBoundingClientRect();
  return {
    top: rect.top - containerRect.top + (target as HTMLElement).scrollTop,
    left: rect.left - containerRect.left + (target as HTMLElement).scrollLeft,
    width: rect.width,
    height: rect.height,
  };
}

export const Affix: Component<AffixProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'offsetTop',
    'offsetBottom',
    'target',
    'onChange',
    'style',
  ]);

  let placeholderRef!: HTMLDivElement;
  let fixedRef!: HTMLDivElement;

  const [affixed, setAffixed] = createSignal(false);
  const [affixStyle, setAffixStyle] = createSignal<JSX.CSSProperties>();
  const [placeholderStyle, setPlaceholderStyle] = createSignal<JSX.CSSProperties>();

  const offsetTop = () => local.offsetTop ?? (local.offsetBottom === undefined ? 0 : undefined);
  const offsetBottom = () => local.offsetBottom;

  const measure = () => {
    const target = local.target?.() ?? window;
    if (!target) return;

    const rect = getTargetRect(target, placeholderRef);
    const scrollTop = getScrollTop(target);
    const viewHeight =
      target === window ? window.innerHeight : (target as HTMLElement).clientHeight;

    let nextAffixed = false;
    let nextAffixStyle: JSX.CSSProperties = {};
    const nextPlaceholderStyle: JSX.CSSProperties = {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    };

    if (offsetBottom() !== undefined) {
      const bottomOffset = offsetBottom() ?? 0;
      const targetScrollHeight =
        target === window ? document.documentElement.scrollHeight : (target as HTMLElement).scrollHeight;
      nextAffixed = scrollTop + viewHeight < targetScrollHeight - bottomOffset - rect.height;
      if (nextAffixed) {
        nextAffixStyle = {
          position: 'fixed',
          bottom: `${bottomOffset}px`,
          width: `${rect.width}px`,
        };
      }
    } else {
      const topOffset = offsetTop() ?? 0;
      nextAffixed = scrollTop > rect.top - topOffset;
      if (nextAffixed) {
        nextAffixStyle = {
          position: 'fixed',
          top: `${topOffset}px`,
          width: `${rect.width}px`,
        };
      }
    }

    if (nextAffixed !== affixed()) {
      setAffixed(nextAffixed);
      local.onChange?.(nextAffixed);
    }
    setAffixStyle(nextAffixed ? nextAffixStyle : undefined);
    setPlaceholderStyle(nextPlaceholderStyle);
  };

  onMount(() => {
    const target = local.target?.() ?? window;
    const handler = () => requestAnimationFrame(measure);
    measure();
    target.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler, { passive: true });
    onCleanup(() => {
      target.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    });
  });

  return (
    <div data-slot="affix">
      <div ref={placeholderRef!} style={placeholderStyle()} aria-hidden={affixed() ? true : undefined} />
      <div
        ref={fixedRef!}
        data-slot="affix-fixed"
        data-affixed={affixed() ? 'true' : 'false'}
        class={cn(affixed() && 'z-10', local.class)}
        style={{
          ...(typeof local.style === 'object' && local.style !== null ? local.style : {}),
          ...affixStyle(),
        }}
        {...rest}
      >
        {local.children}
      </div>
    </div>
  );
};
