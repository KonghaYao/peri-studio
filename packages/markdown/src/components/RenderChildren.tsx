import { For } from 'solid-js';
import type { RenderableNode } from '../lib/node-helpers';
import { NodeOutlet } from './NodeOutlet';
import type { MarkdownRenderContext } from './context';

export function RenderChildren(props: {
  nodes: readonly RenderableNode[];
  context: MarkdownRenderContext;
  prefix?: string;
}) {
  return (
    <For each={props.nodes}>
      {(node, index) => (
        <NodeOutlet
          node={node}
          context={props.context}
          indexKey={`${props.prefix ?? 'node'}-${index()}`}
        />
      )}
    </For>
  );
}
