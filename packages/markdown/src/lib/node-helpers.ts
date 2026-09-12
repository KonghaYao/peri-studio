import type { BaseNode, MarkdownIt, ParsedNode, ParseOptions } from 'stream-markdown-parser';
import { getMarkdown, normalizeCustomHtmlTags, parseMarkdownToStructure } from 'stream-markdown-parser';

export type RenderableNode = (ParsedNode | BaseNode) & Record<string, unknown>;

export const BLOCK_LEVEL_TYPES = new Set([
  'table',
  'code_block',
  'html_block',
  'blockquote',
  'list',
  'list_item',
  'definition_list',
  'footnote',
  'admonition',
  'thematic_break',
  'math_block',
]);

const markdownCache = new Map<string, MarkdownIt>();

export function getString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function getNodeList(value: unknown): RenderableNode[] {
  return Array.isArray(value)
    ? value.filter((item): item is RenderableNode => !!item && typeof item === 'object')
    : [];
}

export function normalizeCodeLanguage(raw: unknown) {
  const head = String(String(raw ?? '').split(/\s+/g)[0] ?? '').toLowerCase();
  const safe = head.replace(/[^\w-]/g, '');
  return safe || 'plaintext';
}

export function resolveCodeBlockLanguage(node: RenderableNode) {
  return normalizeCodeLanguage((node as { language?: string }).language);
}

export function resolveParsedNodes(
  content: string,
  options: {
    final?: boolean;
    customId?: string;
    parseOptions?: ParseOptions;
    customHtmlTags?: readonly string[];
  },
): RenderableNode[] {
  if (!content) return [];

  const normalizedTags = normalizeCustomHtmlTags([
    ...(options.customHtmlTags || []),
    ...(options.parseOptions?.customHtmlTags || []),
  ]);
  const cacheKey = `${options.customId || 'peri-markdown'}::${normalizedTags.join(',')}`;
  let markdown = markdownCache.get(cacheKey);
  if (!markdown) {
    markdown = getMarkdown(cacheKey, { customHtmlTags: normalizedTags });
    markdownCache.set(cacheKey, markdown);
  }

  const parseOpts: ParseOptions = {
    ...(options.parseOptions ?? {}),
    streamParse: options.parseOptions?.streamParse ?? 'auto',
  };
  if (typeof options.final === 'boolean') parseOpts.final = options.final;
  if (normalizedTags.length > 0) parseOpts.customHtmlTags = normalizedTags;

  return parseMarkdownToStructure(content, markdown, parseOpts) as RenderableNode[];
}

export function splitParagraphChildren(children: readonly RenderableNode[]) {
  const parts: Array<
    | { kind: 'inline'; nodes: RenderableNode[] }
    | { kind: 'block'; node: RenderableNode }
  > = [];
  const inlineBuffer: RenderableNode[] = [];

  const flushInline = () => {
    if (!inlineBuffer.length) return;
    parts.push({ kind: 'inline', nodes: inlineBuffer.slice() });
    inlineBuffer.length = 0;
  };

  for (const child of children) {
    if (BLOCK_LEVEL_TYPES.has(String(child?.type || ''))) {
      flushInline();
      parts.push({ kind: 'block', node: child });
    } else {
      inlineBuffer.push(child);
    }
  }
  flushInline();
  return parts;
}

export function stabilizeNodes(
  nextNodes: RenderableNode[],
  previous: Array<{ node: RenderableNode; signature: string }>,
  incompleteTail: boolean,
) {
  return nextNodes.map((node, index) => {
    const streamEdge = incompleteTail && index === nextNodes.length - 1 ? '\u0000incomplete' : '';
    const signature = JSON.stringify(node) + streamEdge;
    const cached = previous[index];
    return cached?.signature === signature ? cached : { node, signature };
  });
}
