import {
  createHighlighter,
  type HighlightToken,
  type HighlightTokenResult,
} from '@tanstack/highlight/core';
import { python } from '@tanstack/highlight/languages/python';
import { shell } from '@tanstack/highlight/languages/shell';
import { ts } from '@tanstack/highlight/languages/ts';
import { createThemeCss } from '@tanstack/highlight/theme';
import { githubLightTheme } from '@tanstack/highlight/themes/github-light';

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'shell',
  js: 'js',
  javascript: 'js',
  py: 'python',
  python: 'python',
  sh: 'shell',
  shell: 'shell',
  ts: 'ts',
  typescript: 'ts',
  zsh: 'shell',
};

export const codeHighlighter = createHighlighter({
  languages: [shell, ts, python],
});

let themeInjected = false;

/** 注入 TanStack Highlight 主题（github-light，作用域在 .code-block-highlight）。 */
export function ensureHighlightTheme() {
  if (themeInjected) return;
  themeInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-peri-highlight-theme', '');
  style.textContent = createThemeCss({
    light: githubLightTheme,
    codeBlockSelector: '.code-block-highlight pre',
  });
  document.head.append(style);
}

export function normalizeLanguage(language: string) {
  const alias = LANGUAGE_ALIASES[language.toLowerCase()];
  return codeHighlighter.normalizeLanguage(alias ?? language);
}

export function highlightCode(code: string, language: string): HighlightTokenResult {
  return codeHighlighter.tokenize(code, { lang: normalizeLanguage(language) });
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
