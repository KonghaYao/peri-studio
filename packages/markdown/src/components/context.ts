import type { CodeBlockViewComponent, MermaidBlockViewComponent } from '../types';

export interface MarkdownRenderContext {
  final: boolean;
  CodeBlockView: CodeBlockViewComponent;
  MermaidBlockView: MermaidBlockViewComponent;
}
