import { FileText, Menu } from 'lucide-solid';
import { IconButton } from '@/components/ui';

export function ChatHeader(props: { title: string }) {
  return (
    <header class="flex h-13 items-center gap-2 border-b border-border-subtle bg-surface-overlay px-4">
      <IconButton label="Open navigation" size="sm" class="hidden">
        <Menu size={16} strokeWidth={1.7} />
      </IconButton>
      <IconButton label="Open workspace resources" size="sm">
        <FileText size={16} strokeWidth={1.7} />
      </IconButton>
      <strong class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-14 font-semibold">{props.title}</strong>
    </header>
  );
}
