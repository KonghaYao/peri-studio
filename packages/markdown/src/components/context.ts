import type { CodeBlockViewComponent, MathExpressionViewComponent, MermaidBlockViewComponent } from '../types';

export interface MarkdownRenderContext {
  final: boolean;
  isDark?: boolean;
  CodeBlockView: CodeBlockViewComponent;
  MermaidBlockView: MermaidBlockViewComponent;
  MathExpressionView: MathExpressionViewComponent;
}
