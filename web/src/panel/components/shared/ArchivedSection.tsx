import type { JSX } from 'solid-js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Icon } from '../../../components/ui';

export interface ArchivedSectionProps {
  toggleClass: string;
  label: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listId: string;
  listClass: string;
  children: JSX.Element;
}

export function ArchivedSection(props: ArchivedSectionProps) {
  return (
    <Collapsible class="contents" open={props.open} onOpenChange={props.onOpenChange}>
      <CollapsibleTrigger class={props.toggleClass}>
        <Icon size="small"><path d="m7 5 5 5-5 5" /></Icon>
        <span>{props.label}</span>
        <small>{props.count}</small>
      </CollapsibleTrigger>
      <CollapsibleContent id={props.listId} class={props.listClass}>{props.children}</CollapsibleContent>
    </Collapsible>
  );
}
