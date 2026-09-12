import type { RenderableNode } from './node-helpers';
import { resolveCodeBlockLanguage } from './node-helpers';

export type CodeBlockMode = 'mermaid' | 'math' | 'code';

export function resolveCodeBlockMode(node: RenderableNode): CodeBlockMode {
  const language = resolveCodeBlockLanguage(node);
  if (language === 'mermaid') return 'mermaid';
  if (language === 'math') return 'math';
  return 'code';
}

export function getNodeCode(node: RenderableNode) {
  return String((node as { code?: string }).code ?? '');
}
