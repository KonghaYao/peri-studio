import { Show } from 'solid-js';

/** 资源引用块：名称、类型与可选 resource id。 */
export function ResourceCite(props: { name: string; mediaType?: string; resourceId?: string }) {
  return (
    <section class="message-resource rounded-lg bg-surface-sunken px-12 py-10" aria-label={props.name}>
      <div class="flex items-baseline gap-8">
        <strong class="text-13 font-semibold text-content-primary">{props.name}</strong>
        <span class="text-12 text-content-muted">{props.mediaType || 'Unknown type'}</span>
      </div>
      <Show when={props.resourceId}>
        <code class="mt-4 block font-mono text-11 text-content-muted" title={props.resourceId}>{props.resourceId}</code>
      </Show>
    </section>
  );
}
