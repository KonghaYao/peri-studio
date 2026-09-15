import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../lib/cn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './Card';

export type PanelCardProps = {
  title: string;
  description?: string;
  isEmpty?: boolean;
  emptyMessage?: string;
  class?: string;
  children: JSX.Element;
};

/** T3 · Titled panel card with a consistent empty state slot. */
export const PanelCard: Component<PanelCardProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'title',
    'description',
    'isEmpty',
    'emptyMessage',
    'class',
    'children',
  ]);

  return (
    <Card {...rest} class={cn('flex flex-col', local.class)}>
      <CardHeader>
        <CardTitle>{local.title}</CardTitle>
        <Show when={local.description}>
          <CardDescription>{local.description}</CardDescription>
        </Show>
      </CardHeader>
      <CardContent class="flex-1">
        <Show
          when={!local.isEmpty}
          fallback={
            <p class="py-64 text-center text-13 text-text-muted">
              {local.emptyMessage ?? 'No data in the selected range.'}
            </p>
          }
        >
          {local.children}
        </Show>
      </CardContent>
    </Card>
  );
};
