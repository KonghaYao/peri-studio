import { For } from 'solid-js';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

export type ArchivedBrowserItem = {
  id: string;
  title: string;
  subtitle: string;
};

/** 归档浏览弹窗列表：紧凑行高、细间距（对齐 style-demo archived 列表）。 */
export function ArchivedBrowserList(props: {
  items: ArchivedBrowserItem[];
  class?: string;
  onRestore?: (id: string) => void;
  restoringId?: string | null;
  readOnly?: boolean;
}) {
  return (
    <ul
      class={cn(
        'archived-browser-list m-0 grid max-h-60 list-none gap-1 overflow-auto p-0',
        props.class,
      )}
      aria-label="Archived items"
    >
      <For each={props.items}>
        {(item) => (
          <li class="archived-browser-row flex min-h-8 items-center gap-2 rounded-md px-2.5 py-1.5 hover:bg-interaction-hover">
            <span class="grid min-w-0 flex-1 gap-0.5">
              <strong class="overflow-hidden text-ellipsis whitespace-nowrap text-13 font-normal text-content-primary">
                {item.title}
              </strong>
              <small class="overflow-hidden text-ellipsis whitespace-nowrap text-11 text-content-muted">
                {item.subtitle}
              </small>
            </span>
            <Button
              variant="ghost"
              size="sm"
              class="h-6! shrink-0 px-2! text-11!"
              busy={props.restoringId === item.id}
              disabled={props.readOnly || !!props.restoringId}
              onClick={() => props.onRestore?.(item.id)}
            >
              Restore
            </Button>
          </li>
        )}
      </For>
    </ul>
  );
}
