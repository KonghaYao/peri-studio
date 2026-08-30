import type { JSX } from 'solid-js';

/** SCM 分组头：对齐 sidebar SectionHeader。 */
export function GitChangeGroup(props: {
  label: string;
  count: number;
  children: JSX.Element;
}) {
  return (
    <section class="pb-0.5">
      <div class="flex items-center gap-1 px-2.5 pb-1 pt-3">
        <span class="min-w-0 flex-1 text-12 text-content-muted">{props.label}</span>
        <span class="tabular-nums text-11 text-content-muted">{props.count}</span>
      </div>
      {props.children}
    </section>
  );
}
