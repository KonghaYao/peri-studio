import { For } from 'solid-js';
import { cn } from '../lib/cn';
import { Button } from './Button';

export type ArchivedBrowserItem = {
  id: string;
  title: string;
  subtitle: string;
};

/** 归档浏览弹窗列表：紧凑行高、细间距。 */
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
        'archived-browser-list ui-scrollbar m-0 grid max-h-(--container-search-results) list-none gap-1 overflow-auto p-0',
        props.class,
      )}
      aria-label="Archived items"
    >
      <For each={props.items}>
        {(item) => (
          <li class="archived-browser-row flex min-h-36 items-center gap-8 rounded-md px-10 py-6 hover:bg-interaction-hover pointer-coarse:min-h-44">
            <span class="grid min-w-0 flex-1 gap-1">
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
              class="h-28! shrink-0 px-8! text-11! pointer-coarse:min-h-44!"
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
