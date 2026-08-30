import { Tabs as KTabs } from '@kobalte/core/tabs';
import { For, type JSX } from 'solid-js';
import { cn } from '@/lib/cn';

/* AntD 风格：底部发丝线 + 激活项主色文字与指示条 */
export function Tabs(props: {
  tabs: { value: string; label: JSX.Element }[];
  value?: string;
  onChange?: (value: string) => void;
  class?: string;
}) {
  return (
    <KTabs value={props.value} onChange={props.onChange} class={props.class}>
      <KTabs.List class="relative flex gap-4 border-b border-border-subtle">
        <For each={props.tabs}>
          {(tab) => (
            <KTabs.Trigger
              value={tab.value}
              class={cn(
                '-mb-px cursor-pointer border-b-2 border-transparent px-1 py-2 text-13 text-content-secondary transition-colors duration-(--duration-fast) outline-none',
                'hover:text-content-primary focus-visible:text-content-primary',
                'data-[selected]:border-accent-solid data-[selected]:text-accent-solid data-[selected]:font-medium',
              )}
            >
              {tab.label}
            </KTabs.Trigger>
          )}
        </For>
      </KTabs.List>
    </KTabs>
  );
}
