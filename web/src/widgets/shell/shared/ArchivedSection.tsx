import type { JSX } from 'solid-js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Icon } from '@peri/ui';

export interface ArchivedSectionProps {
  label: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: string;
  children: JSX.Element;
}

export function ArchivedSection(props: ArchivedSectionProps) {
  return (
    <Collapsible class="contents" open={props.open} onOpenChange={props.onOpenChange}>
      <CollapsibleTrigger data-testid="archived-section-toggle">
        <Icon size="small"><path d="m7 5 5 5-5 5" /></Icon>
        <span>{props.label}</span>
        <small>{props.count}</small>
      </CollapsibleTrigger>
      <CollapsibleContent id={props.listId} data-testid="archived-section-list">{props.children}</CollapsibleContent>
    </Collapsible>
  );
}
