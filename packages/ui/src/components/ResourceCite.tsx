import { Show, splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../lib/cn';

type ResourceCiteProps = ComponentProps<'section'> & {
  name: string;
  mediaType?: string;
  resourceId?: string;
};

/** 消息流内资源引用卡（对齐 sandbox blocks ResourceCite）。 */
export const ResourceCite: Component<ResourceCiteProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'name', 'mediaType', 'resourceId']);
  return (
    <section
      data-slot="resource-cite"
      class={cn('rounded-lg bg-surface-muted px-12 py-10', local.class)}
      aria-label={local.name}
      {...rest}
    >
      <div class="flex items-baseline gap-8">
        <strong class="text-13 font-semibold text-content-primary">{local.name}</strong>
        <span class="text-12 text-content-muted">{local.mediaType || 'Unknown type'}</span>
      </div>
      <Show when={local.resourceId}>
        <code class="mt-4 block font-mono text-11 text-content-muted" title={local.resourceId}>
          {local.resourceId}
        </code>
      </Show>
    </section>
  );
};
