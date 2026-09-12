import type { Component, ComponentProps } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../lib/cn';

/** shadcn 对齐的排版原语：仅样式化元素，无 Kobalte 依赖。 */

export const TypographyH1: Component<ComponentProps<'h1'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <h1
      class={cn(
        'scroll-mt-20 text-28 font-bold tracking-tight text-content-primary',
        local.class,
      )}
      {...rest}
    />
  );
};

export const TypographyH2: Component<ComponentProps<'h2'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <h2
      class={cn(
        'scroll-mt-20 border-b border-border-subtle pb-8 text-24 font-semibold tracking-tight text-content-primary',
        local.class,
      )}
      {...rest}
    />
  );
};

export const TypographyH3: Component<ComponentProps<'h3'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <h3
      class={cn(
        'scroll-mt-20 text-18 font-semibold tracking-tight text-content-primary',
        local.class,
      )}
      {...rest}
    />
  );
};

export const TypographyH4: Component<ComponentProps<'h4'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <h4
      class={cn(
        'scroll-mt-20 text-16 font-semibold tracking-tight text-content-primary',
        local.class,
      )}
      {...rest}
    />
  );
};

export const TypographyP: Component<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <p
      class={cn('text-13 leading-20 text-content-primary', local.class)}
      {...rest}
    />
  );
};

export const TypographyLead: Component<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <p
      class={cn('text-16 leading-20 text-content-muted', local.class)}
      {...rest}
    />
  );
};

export const TypographyLarge: Component<ComponentProps<'div'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      class={cn('text-14 font-semibold text-content-primary', local.class)}
      {...rest}
    />
  );
};

export const TypographySmall: Component<ComponentProps<'small'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <small
      class={cn('text-12 font-medium leading-12 text-content-primary', local.class)}
      {...rest}
    />
  );
};

export const TypographyMuted: Component<ComponentProps<'p'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <p
      class={cn('text-12 text-content-muted', local.class)}
      {...rest}
    />
  );
};

export const TypographyBlockquote: Component<ComponentProps<'blockquote'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <blockquote
      class={cn(
        'border-l-2 border-border-strong pl-12 italic text-content-secondary',
        local.class,
      )}
      {...rest}
    />
  );
};

export const TypographyInlineCode: Component<ComponentProps<'code'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <code
      class={cn(
        'relative rounded-4 bg-surface-muted px-6 py-2 font-mono text-12 font-semibold text-content-primary',
        local.class,
      )}
      {...rest}
    />
  );
};

export const TypographyList: Component<ComponentProps<'ul'>> = (props) => {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <ul
      class={cn(
        'my-12 ml-16 list-disc text-13 leading-20 text-content-primary',
        local.class,
      )}
      {...rest}
    />
  );
};

/** 简短别名，与 shadcn Typography 导出一致。 */
export const H1 = TypographyH1;
export const H2 = TypographyH2;
export const H3 = TypographyH3;
export const H4 = TypographyH4;
export const P = TypographyP;
export const Lead = TypographyLead;
export const Large = TypographyLarge;
export const Small = TypographySmall;
export const Muted = TypographyMuted;
export const Blockquote = TypographyBlockquote;
export const InlineCode = TypographyInlineCode;
export const List = TypographyList;
