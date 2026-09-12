import {
  createHighlighter,
  type HighlightToken,
  type HighlightTokenResult,
} from '@tanstack/highlight/core';
import { cpp } from '@tanstack/highlight/languages/cpp';
import { css } from '@tanstack/highlight/languages/css';
import { diff } from '@tanstack/highlight/languages/diff';
import { dockerfile } from '@tanstack/highlight/languages/dockerfile';
import { go } from '@tanstack/highlight/languages/go';
import { html } from '@tanstack/highlight/languages/html';
import { js } from '@tanstack/highlight/languages/js';
import { json } from '@tanstack/highlight/languages/json';
import { jsx } from '@tanstack/highlight/languages/jsx';
import { markdown } from '@tanstack/highlight/languages/markdown';
import { php } from '@tanstack/highlight/languages/php';
import { python } from '@tanstack/highlight/languages/python';
import { shell } from '@tanstack/highlight/languages/shell';
import { sql } from '@tanstack/highlight/languages/sql';
import { toml } from '@tanstack/highlight/languages/toml';
import { ts } from '@tanstack/highlight/languages/ts';
import { tsx } from '@tanstack/highlight/languages/tsx';
import { yaml } from '@tanstack/highlight/languages/yaml';
import { createThemeCss, themeTokenClasses } from '@tanstack/highlight/theme';
import { githubLightTheme } from '@tanstack/highlight/themes/github-light';

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'shell',
  c: 'cpp',
  cpp: 'cpp',
  css: 'css',
  diff: 'diff',
  dockerfile: 'dockerfile',
  go: 'go',
  html: 'html',
  java: 'js',
  javascript: 'js',
  js: 'js',
  json: 'json',
  jsx: 'jsx',
  kotlin: 'js',
  markdown: 'markdown',
  md: 'markdown',
  php: 'php',
  py: 'python',
  python: 'python',
  rb: 'ruby',
  ruby: 'js',
  rs: 'rust',
  rust: 'rust',
  sh: 'shell',
  shell: 'shell',
  shellscript: 'shell',
  sql: 'sql',
  swift: 'js',
  toml: 'toml',
  ts: 'ts',
  tsx: 'tsx',
  typescript: 'ts',
  xml: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell',
};

export const codeHighlighter = createHighlighter({
  languages: [
    shell,
    ts,
    tsx,
    js,
    jsx,
    python,
    json,
    yaml,
    markdown,
    css,
    html,
    go,
    cpp,
    dockerfile,
    sql,
    php,
    toml,
    diff,
  ],
});

let themeInjected = false;

const HIGHLIGHT_SCOPE = '.code-block-highlight';

/** 注入 TanStack Highlight 主题（github-light，作用域在 .code-block-highlight）。 */
export function ensureHighlightTheme() {
  if (themeInjected || typeof document === 'undefined') return;
  themeInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-peri-highlight-theme', '');
  const themeVars = createThemeCss({
    light: githubLightTheme,
    lightSelector: HIGHLIGHT_SCOPE,
    includeBaseStyles: false,
  });
  const tokenRules = themeTokenClasses
    .map((token) => `${HIGHLIGHT_SCOPE} .th-${token} { color: var(--th-${token}); }`)
    .join('\n');
  style.textContent = `${themeVars}\n${tokenRules}`;
  document.head.append(style);
}

export function normalizeLanguage(language: string) {
  const alias = LANGUAGE_ALIASES[language.toLowerCase()];
  return codeHighlighter.normalizeLanguage(alias ?? language);
}

export function highlightCode(code: string, language: string): HighlightTokenResult {
  return codeHighlighter.tokenize(code, { lang: normalizeLanguage(language) });
}

export function hasSyntaxHighlighting(code: string, language: string) {
  const result = highlightCode(code, language);
  if (result.lang === 'plaintext') return false;
  return result.tokens.some((token) => token.className);
}

export function tokensByLine(tokens: ReadonlyArray<HighlightToken>): HighlightToken[][] {
  const lines: HighlightToken[][] = [[]];

  for (const token of tokens) {
    const segments = token.value.split('\n');
    for (let index = 0; index < segments.length; index++) {
      if (index > 0) lines.push([]);
      const segment = segments[index];
      if (segment.length === 0) continue;
      lines[lines.length - 1].push(
        token.className ? { className: token.className, value: segment } : { value: segment },
      );
    }
  }

  return lines.length > 0 ? lines : [[]];
}
