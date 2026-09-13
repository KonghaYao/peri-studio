import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { EMPTY_PRESETS, type EmptyPresetName } from './empty-presets';

type Props = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children'> & {
  title: string;
  description?: string;
  icon?: JSX.Element;
  preset?: EmptyPresetName;
  image?: JSX.Element;
  action?: JSX.Element;
  variant?: 'page' | 'inline';
};

const VARIANT_CLASS: Record<NonNullable<Props['variant']>, string> = {
  page: 'flex-1 px-32 py-48',
  inline: 'flex-initial rounded-8 border border-border-subtle bg-surface p-24',
};

export function EmptyState(props: Props) {
  const [local, div] = splitProps(props, [
    'title',
    'description',
    'icon',
    'preset',
    'image',
    'action',
    'variant',
    'class',
  ]);
  const visual = () => {
    if (local.image) return local.image;
    if (local.icon) return local.icon;
    if (local.preset) {
      const Preset = EMPTY_PRESETS[local.preset];
      return <Preset />;
    }
    return null;
  };

  return (
    <div
      {...div}
      class={cn(
        'flex min-h-0 flex-col items-center justify-center gap-8 py-48 text-center',
        VARIANT_CLASS[local.variant ?? 'page'],
        local.class,
      )}
    >
      <Show when={visual()}>
        <div
          class={cn(
            'mb-4 flex items-center justify-center',
            local.preset ? '[&_svg]:h-120 [&_svg]:w-auto' : 'text-text-faint',
          )}
          aria-hidden="true"
        >
          {visual()}
        </div>
      </Show>
      <h2 class="text-13 font-medium text-text-primary">{local.title}</h2>
      {local.description && (
        <p class="max-w-360 text-12 leading-normal text-text-muted">{local.description}</p>
      )}
      {local.action && <div class="mt-12">{local.action}</div>}
    </div>
  );
}
