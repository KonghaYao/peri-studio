import { memoizeAsync } from './async-cache';
import type { LanguageInput } from 'shiki/core';

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'bash', c: 'c', cpp: 'cpp', css: 'css', go: 'go', html: 'html', java: 'java', js: 'javascript', javascript: 'javascript', json: 'json', jsx: 'jsx', kotlin: 'kotlin', markdown: 'markdown', md: 'markdown', php: 'php', py: 'python', python: 'python', rb: 'ruby', ruby: 'ruby', rs: 'rust', rust: 'rust', sh: 'shellscript', shell: 'shellscript', sql: 'sql', swift: 'swift', ts: 'typescript', tsx: 'tsx', typescript: 'typescript', xml: 'xml', yaml: 'yaml', yml: 'yaml', zsh: 'zsh',
};

type LanguageModule = { default: LanguageInput[] };

const LANGUAGE_LOADERS: Record<string, () => Promise<LanguageModule>> = {
  bash: () => import('shiki/dist/langs/bash.mjs'),
  c: () => import('shiki/dist/langs/c.mjs'),
  cpp: () => import('shiki/dist/langs/cpp.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  dockerfile: () => import('shiki/dist/langs/dockerfile.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  html: () => import('shiki/dist/langs/html.mjs'),
  java: () => import('shiki/dist/langs/java.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  jsx: () => import('shiki/dist/langs/jsx.mjs'),
  kotlin: () => import('shiki/dist/langs/kotlin.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
  php: () => import('shiki/dist/langs/php.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  ruby: () => import('shiki/dist/langs/ruby.mjs'),
  rust: () => import('shiki/dist/langs/rust.mjs'),
  shellscript: () => import('shiki/dist/langs/shellscript.mjs'),
  sql: () => import('shiki/dist/langs/sql.mjs'),
  swift: () => import('shiki/dist/langs/swift.mjs'),
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  xml: () => import('shiki/dist/langs/xml.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
  zsh: () => import('shiki/dist/langs/zsh.mjs'),
};

const highlighter = Promise.all([
  import('shiki/core'),
  import('shiki/engine/javascript'),
  import('shiki/dist/themes/github-light-default.mjs'),
]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme]) => createHighlighterCore({
  themes: [theme.default],
  langs: [],
  engine: createJavaScriptRegexEngine(),
}));

async function loadHighlight(code: string, language: string) {
  const load = LANGUAGE_LOADERS[language];
  if (!load) return { result: null, error: false };
  const instance = await highlighter;
  if (!instance.getLoadedLanguages().includes(language)) {
    const module = await load();
    await instance.loadLanguage(...module.default);
  }
  return { result: instance.codeToTokens(code, { lang: language, theme: 'github-light-default' }), error: false };
}

const loadHighlightCached = memoizeAsync((code: string, language: string) => `${language}\u0000${code}`, loadHighlight);

export async function highlightCode(code: string, language: string) {
  const normalized = LANGUAGE_ALIASES[language] || language;
  try {
    return await loadHighlightCached(code, normalized);
  } catch {
    return { result: null, error: true };
  }
}
