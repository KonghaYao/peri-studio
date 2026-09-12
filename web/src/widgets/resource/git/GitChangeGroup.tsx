import { GitChangeGroup as UiGitChangeGroup } from '@peri/ui';
import type { JSX } from 'solid-js';

export function GitChangeGroup(props: {
  label: string;
  count: number;
  children: JSX.Element;
}) {
  return <UiGitChangeGroup titleTestId="resource-group-title" {...props} />;
}
