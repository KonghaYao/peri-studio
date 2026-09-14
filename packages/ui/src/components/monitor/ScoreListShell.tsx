import { For, Show, splitProps, type Component } from 'solid-js';
import { Star } from 'lucide-solid';
import { cn } from '../../lib/cn';
import { Badge } from '../Badge';

export type ScoreListShellItem = {
  id: string;
  name: string;
  source: string;
  value?: number | null;
  textValue?: string | null;
};

export type ScoreListShellProps = {
  scores: ScoreListShellItem[];
  emptyLabel?: string;
  class?: string;
  'data-testid'?: string;
};

function formatScoreValue(item: ScoreListShellItem): string {
  if (item.textValue) return item.textValue;
  if (item.value !== null && item.value !== undefined) return item.value.toFixed(4);
  return '—';
}

/** T3 · 通用 score 列表壳：name / source / value，无观测领域类型。 */
export const ScoreListShell: Component<ScoreListShellProps> = (props) => {
  const [local, rest] = splitProps(props, ['scores', 'emptyLabel', 'class']);
  const emptyLabel = () => local.emptyLabel ?? 'No scores.';

  return (
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'score-list-shell'}
      class={cn('ui-score-list-shell', local.class)}
    >
      <Show
        when={local.scores.length > 0}
        fallback={<p class="text-12 text-content-muted">{emptyLabel()}</p>}
      >
        <div class="flex flex-col gap-8">
          <For each={local.scores}>
            {(score) => (
              <div
                class="flex items-center justify-between gap-12 rounded-6 border border-border-subtle px-12 py-8"
                data-testid={`score-list-item-${score.id}`}
              >
                <div class="flex min-w-0 items-center gap-8">
                  <Star size={14} class="shrink-0 text-content-muted" aria-hidden="true" />
                  <span class="truncate text-12 font-600 text-content-primary">{score.name}</span>
                  <Badge tone="neutral">{score.source}</Badge>
                </div>
                <span class="shrink-0 font-mono text-12 tabular-nums text-content-secondary">
                  {formatScoreValue(score)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
