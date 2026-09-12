import type { MermaidBlockViewProps } from '@peri/markdown';
import { MermaidBlock } from './MermaidBlock';

export function MermaidBlockView(props: MermaidBlockViewProps) {
  return <MermaidBlock code={props.code} incomplete={props.loading} />;
}
