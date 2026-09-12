import { splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';
import { Badge } from './Badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './HoverCard';

/** 行内引用根容器，与正文同排。 */
export const InlineCitation: Component<ComponentProps<'span'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <span
      data-slot="inline-citation"
      class={cn('inline-flex items-baseline gap-4', local.class)}
      {...rest}
    >
      {local.children}
    </span>
  );
};

function formatCitationHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

type InlineCitationCardProps = ComponentProps<typeof HoverCard> & {
  sources: string[];
  class?: string;
};

/** 悬停展示引用详情的卡片；触发器显示首条来源域名与剩余数量。 */
export const InlineCitationCard: Component<InlineCitationCardProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children', 'sources']);
  const primarySource = () => local.sources[0];
  const extraCount = () => Math.max(0, local.sources.length - 1);

  return (
    <span data-slot="inline-citation-card" class={cn('inline-flex', local.class)}>
    <HoverCard {...rest}>
      <HoverCardTrigger
        as="button"
        type="button"
        class="inline-flex cursor-pointer border-0 bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-2"
      >
        <Badge class="align-middle">
          {primarySource() ? (
            <>
              {formatCitationHostname(primarySource()!)}
              {extraCount() > 0 ? ` +${extraCount()}` : ''}
            </>
          ) : (
            'unknown'
          )}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent class="w-(--container-popover) max-w-full p-12">
        <div class="flex flex-col gap-8 text-12 text-content-secondary">{local.children}</div>
      </HoverCardContent>
    </HoverCard>
    </span>
  );
};

/** 引用摘录块。 */
export const InlineCitationQuote: Component<ComponentProps<'blockquote'>> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <blockquote
      data-slot="inline-citation-quote"
      class={cn(
        'm-0 border-l-2 border-border-strong pl-10 text-12 leading-normal text-content-muted italic',
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </blockquote>
  );
};
