import { For, Show } from 'solid-js';
import { parseCodeFenceInfo } from '../lib/fence-meta';
import { getNodeList, getString, splitParagraphChildren, type RenderableNode } from '../lib/node-helpers';
import { getNodeCode, resolveCodeBlockMode } from '../lib/node-outlet-helpers';
import { safeHref } from '../lib/safe';
import type { MarkdownRenderContext } from './context';
import { RenderChildren } from './RenderChildren';
import { TableNode } from './TableNode';
import { SafeImage } from './SafeImage';

function SafeLink(props: { href?: string; title?: string | null; children?: unknown }) {
  const href = () => safeHref(props.href);
  return (
    <Show
      when={href()}
      fallback={<span>{props.children as never} ({String(props.href || '')})</span>}
    >
      {(value) => (
        <a href={value()} title={props.title ?? undefined} target={value().startsWith('#') ? undefined : '_blank'} rel={value().startsWith('#') ? undefined : 'noopener noreferrer'}>
          {props.children as never}
        </a>
      )}
    </Show>
  );
}

function listItemHasCheckbox(item: RenderableNode) {
  const walk = (nodes: RenderableNode[]): boolean =>
    nodes.some((node) => {
      const nodeType = String(node.type || '');
      if (nodeType === 'checkbox' || nodeType === 'checkbox_input') return true;
      return walk(getNodeList((node as { children?: RenderableNode[] }).children));
    });
  return walk(getNodeList((item as { children?: RenderableNode[] }).children));
}

function InlineCode(props: { code: string }) {
  return (
    <code data-testid="md-inline-code" class="md-inline-code rounded-sm border border-border-subtle bg-surface-muted px-4 py-2 text-11p5 text-content-primary">
      {props.code}
    </code>
  );
}

function ParagraphNode(props: { node: RenderableNode; context: MarkdownRenderContext; indexKey: string }) {
  const parts = () => splitParagraphChildren(getNodeList((props.node as { children?: RenderableNode[] }).children));
  return (
    <For each={parts()}>
      {(part, index) => (
        part.kind === 'inline'
          ? (
            <p>
              <RenderChildren nodes={part.nodes} context={props.context} prefix={`${props.indexKey}-${index()}`} />
            </p>
          )
          : <NodeOutlet node={part.node} context={props.context} indexKey={`${props.indexKey}-${index()}`} />
      )}
    </For>
  );
}

export function NodeOutlet(props: { node: RenderableNode; context: MarkdownRenderContext; indexKey?: string }) {
  const type = () => String(props.node.type || '');
  const indexKey = () => props.indexKey ?? 'node';

  return (
    <Show
      when={type() !== 'text' && type() !== 'text_special'}
      fallback={getString((props.node as { content?: string }).content ?? (props.node as { raw?: string }).raw)}
    >
      <SwitchNode node={props.node} context={props.context} indexKey={indexKey()} type={type()} />
    </Show>
  );
}

function SwitchNode(props: {
  node: RenderableNode;
  context: MarkdownRenderContext;
  indexKey: string;
  type: string;
}) {
  switch (props.type) {
    case 'paragraph':
      return <ParagraphNode node={props.node} context={props.context} indexKey={props.indexKey} />;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number((props.node as { level?: number }).level) || 1));
      const children = (
        <RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} />
      );
      if (level === 1) return <h1>{children}</h1>;
      if (level === 2) return <h2>{children}</h2>;
      if (level === 3) return <h3>{children}</h3>;
      if (level === 4) return <h4>{children}</h4>;
      if (level === 5) return <h5>{children}</h5>;
      return <h6>{children}</h6>;
    }
    case 'blockquote':
      return (
        <blockquote>
          <RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} />
        </blockquote>
      );
    case 'list': {
      const ordered = Boolean((props.node as { ordered?: boolean }).ordered);
      const start = Number((props.node as { start?: number }).start);
      const items = () => getNodeList((props.node as { items?: RenderableNode[] }).items);
      const taskList = () => !ordered && items().some((item) => listItemHasCheckbox(item));
      return ordered
        ? (
          <ol start={Number.isFinite(start) ? start : undefined}>
            <For each={items()}>{(item) => <NodeOutlet node={item} context={props.context} indexKey={`${props.indexKey}-item`} />}</For>
          </ol>
        )
        : (
          <ul class={taskList() ? 'markdown-task-list' : undefined}>
            <For each={items()}>{(item) => <NodeOutlet node={item} context={props.context} indexKey={`${props.indexKey}-item`} />}</For>
          </ul>
        );
    }
    case 'list_item':
      return (
        <li>
          <RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} />
        </li>
      );
    case 'table':
      return <TableNode node={props.node} context={props.context} />;
    case 'thematic_break':
      return <hr />;
    case 'hardbreak':
      return <br />;
    case 'inline_code':
      return <InlineCode code={getString((props.node as { code?: string }).code)} />;
    case 'link':
      return (
        <SafeLink href={(props.node as { href?: string }).href} title={(props.node as { title?: string | null }).title ?? null}>
          <RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} />
        </SafeLink>
      );
    case 'image':
      return (
        <SafeImage
          src={(props.node as { src?: string }).src}
          alt={(props.node as { alt?: string }).alt}
          title={(props.node as { title?: string | null }).title ?? undefined}
        />
      );
    case 'strong':
      return <strong><RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} /></strong>;
    case 'emphasis':
      return <em><RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} /></em>;
    case 'strikethrough':
      return <del><RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} /></del>;
    case 'highlight':
      return <mark><RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} /></mark>;
    case 'insert':
      return <ins><RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} /></ins>;
    case 'subscript':
      return <sub><RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} /></sub>;
    case 'superscript':
      return <sup><RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} /></sup>;
    case 'emoji':
      return <span>{getString((props.node as { emoji?: string }).emoji ?? (props.node as { content?: string }).content)}</span>;
    case 'admonition': {
      const kind = getString((props.node as { kind?: string }).kind || (props.node as { type?: string }).type || 'note');
      return (
        <aside class={`rounded-lg border border-border-subtle bg-surface-overlay px-14 py-12 admonition admonition-${kind}`}>
          <RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} />
        </aside>
      );
    }
    case 'definition_list':
      return (
        <dl>
          <For each={getNodeList((props.node as { items?: RenderableNode[] }).items)}>
            {(item) => (
              <>
                <dt class="font-medium text-content-primary">
                  <RenderChildren nodes={getNodeList((item as { term?: RenderableNode[] }).term)} context={props.context} prefix={`${props.indexKey}-term`} />
                </dt>
                <dd class="mb-8 text-content-secondary">
                  <RenderChildren nodes={getNodeList((item as { definition?: RenderableNode[] }).definition)} context={props.context} prefix={`${props.indexKey}-def`} />
                </dd>
              </>
            )}
          </For>
        </dl>
      );
    case 'checkbox':
    case 'checkbox_input':
      return (
        <input
          type="checkbox"
          class="markdown-task-checkbox"
          disabled
          checked={Boolean((props.node as { checked?: boolean }).checked)}
          aria-label={(props.node as { label?: string }).label ?? 'Task item'}
        />
      );
    case 'label_open':
    case 'label_close':
      return null;
    case 'math_inline': {
      const View = props.context.MathExpressionView;
      return <View expression={getString((props.node as { content?: string }).content)} />;
    }
    case 'math_block': {
      const loading = Boolean((props.node as { loading?: boolean }).loading) && !props.context.final;
      const expression = getString((props.node as { content?: string }).content);
      if (loading) {
        return (
          <div class="md-code-block overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-testid="md-code-block" data-incomplete="true">
            <pre class="m-0 overflow-auto bg-surface-sunken px-12 py-10 font-mono text-12"><code>{expression}</code></pre>
          </div>
        );
      }
      const View = props.context.MathExpressionView;
      return <View expression={expression} block />;
    }
    case 'html_block':
    case 'html_inline':
      return <span>{getString((props.node as { content?: string }).content ?? (props.node as { raw?: string }).raw)}</span>;
    case 'code_block': {
      const mode = resolveCodeBlockMode(props.node);
      const loading = Boolean((props.node as { loading?: boolean }).loading) && !props.context.final;
      const code = getNodeCode(props.node);
      const fence = parseCodeFenceInfo(getString((props.node as { language?: string }).language));
      if (mode === 'mermaid') {
        const View = props.context.MermaidBlockView;
        return (
          <div class="md-code-block overflow-hidden rounded-lg border border-border-subtle bg-surface-overlay" data-testid="md-code-block" data-incomplete={loading ? 'true' : undefined}>
            <View code={code} loading={loading} isDark={props.context.isDark} />
          </div>
        );
      }
      if (mode === 'math') {
        const View = props.context.MathExpressionView;
        return <View expression={code.trim()} block />;
      }
      const View = props.context.CodeBlockView;
      return (
        <View
          language={fence.language}
          code={code}
          loading={loading}
          startLine={fence.startLine}
          lineNumbers={fence.lineNumbers}
          filename={fence.filename}
        />
      );
    }
    case 'footnote_reference':
      return (
        <sup>
          <a href={`#${getString((props.node as { id?: string }).id)}`}>
            {getString((props.node as { label?: string }).label ?? (props.node as { id?: string }).id)}
          </a>
        </sup>
      );
    case 'footnote':
      return (
        <footer>
          <RenderChildren nodes={getNodeList((props.node as { children?: RenderableNode[] }).children)} context={props.context} prefix={props.indexKey} />
        </footer>
      );
    case 'footnote_anchor':
      return <span id={getString((props.node as { id?: string }).id)} />;
    default:
      return <pre>{getString((props.node as { raw?: string }).raw)}</pre>;
  }
}
