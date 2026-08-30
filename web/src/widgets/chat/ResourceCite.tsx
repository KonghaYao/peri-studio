import { Show } from 'solid-js';

/** 资源引用块：名称、类型与可选 resource id。 */
export function ResourceCite(props: { name: string; mediaType?: string; resourceId?: string }) {
  return (
    <section class="message-resource rounded-lg bg-surface-muted px-3 py-2.5" aria-label={props.name}>
      <div class="flex items-baseline gap-2">
        <strong class="text-13 font-semibold text-content-primary">{props.name}</strong>
        <span class="text-12 text-content-muted">{props.mediaType || 'Unknown type'}</span>
      </div>
      <Show when={props.resourceId}>
        <code class="mt-1 block font-mono text-11 text-content-muted" title={props.resourceId}>{props.resourceId}</code>
      </Show>
    </section>
  );
}
