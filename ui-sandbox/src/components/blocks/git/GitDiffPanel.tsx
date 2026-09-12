import { cn } from '@/lib/catalog-ui';

/** Git 变更 diff 预览块。 */
export function GitDiffPanel(props: {
  path: string;
  class?: string;
}) {
  return (
    <div class={cn('flex min-h-0 flex-col bg-surface-overlay', props.class)}>
      <div class="px-2.5 pt-2.5 pb-1">
        <p class="truncate text-12 text-content-muted">{props.path}</p>
      </div>
      <div class="min-h-0 flex-1 overflow-auto px-2.5 pb-2.5">
        <div class="overflow-hidden rounded-md bg-surface-sunken font-mono text-11 leading-relaxed">
          <div class="bg-success-soft px-2.5 text-success-strong">+ export function openGitDiffPreview(repoId: string) {'{'}</div>
          <div class="bg-success-soft px-2.5 text-success-strong">+   return requestDiff(payload);</div>
          <div class="bg-danger-soft px-2.5 text-danger-strong">- export function openDiff() {'{'}</div>
          <div class="px-2.5 text-content-muted">&nbsp;&nbsp;// unified diff projection</div>
        </div>
      </div>
    </div>
  );
}
