import type { Component } from 'solid-js';

export interface CodeBlockViewProps {
  language: string;
  code: string;
  loading?: boolean;
  startLine?: number;
  lineNumbers?: boolean;
  filename?: string;
}

export type CodeBlockViewComponent = Component<CodeBlockViewProps>;

export interface MermaidBlockViewProps {
  code: string;
  loading?: boolean;
}

export type MermaidBlockViewComponent = Component<MermaidBlockViewProps>;
