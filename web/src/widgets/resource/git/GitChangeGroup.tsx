import type { JSX } from 'solid-js';

/** SCM 分组头：对齐 sidebar SectionHeader。 */
export function GitChangeGroup(props: {
  label: string;
  count: number;
  children: JSX.Element;
}) {
  return (
    <section class="pb-2">
      <div data-testid="resource-group-title" class="resource-group-title flex h-(--tree-row-height) items-center gap-4 px-7 text-10 font-650 uppercase tracking-4 text-text-secondary pointer-coarse:h-44">
        <span class="min-w-0 flex-1">{props.label}</span>
        <span class="tabular-nums text-text-muted">{props.count}</span>
      </div>
      {props.children}
    </section>
  );
}
