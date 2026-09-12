type CodeElement = HTMLElement & { props?: Record<string, unknown> };

export type MarkdownPreDetails = {
  text: string;
  language: string;
  startLine: number;
  lineNumbers: boolean;
  filename: string;
};

const EXTENSIONS: Record<string, string> = {
  javascript: 'js',
  js: 'js',
  python: 'py',
  py: 'py',
  rust: 'rs',
  rs: 'rs',
  shell: 'sh',
  sh: 'sh',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  markdown: 'md',
  md: 'md',
};

export function parseMarkdownPreChild(child: unknown): MarkdownPreDetails {
  const element = (Array.isArray(child) ? child[0] : child) as CodeElement | undefined;
  const rawProps = element?.props || {};
  const text = element instanceof HTMLElement
    ? element.textContent || ''
    : String(rawProps.children ?? child ?? '');
  const className = element instanceof HTMLElement ? element.className : String(rawProps.class ?? '');
  const language = className.match(/(?:language|lang)-([^\s]+)/)?.[1]?.toLowerCase() || 'text';
  const attr = (name: string) => (element instanceof HTMLElement ? element.getAttribute(name) : rawProps[name]);
  const startLine = Math.max(1, Number(attr('startLine') ?? attr('startline') ?? 1) || 1);
  const lineNumbers = attr('noLineNumbers') == null && attr('nolinenumbers') == null;
  const filename = String(attr('filename') ?? '').trim();

  return {
    text: text.replace(/\n$/, ''),
    language,
    startLine,
    lineNumbers,
    filename,
  };
}

export function markdownCodeFilename(details: MarkdownPreDetails) {
  if (details.filename) return details.filename;
  const extension = EXTENSIONS[details.language] ?? (details.language === 'text' ? 'txt' : details.language);
  return `snippet.${extension}`;
}
