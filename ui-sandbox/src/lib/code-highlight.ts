import type { LanguageInput, TokensResult } from 'shiki/core';

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'bash',
  js: 'javascript',
  javascript: 'javascript',
  json: 'json',
  py: 'python',
  python: 'python',
  rs: 'rust',
  rust: 'rust',
  sh: 'shellscript',
  shell: 'shellscript',
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'zsh',
};

type LanguageModule = { default: LanguageInput[] };

const LANGUAGE_LOADERS: Record<string, () => Promise<LanguageModule>> = {
  bash: () => import('shiki/dist/langs/bash.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  rust: () => import('shiki/dist/langs/rust.mjs'),
  shellscript: () => import('shiki/dist/langs/shellscript.mjs'),
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
};

const highlighter = Promise.all([
  import('shiki/core'),
  import('shiki/engine/javascript'),
  import('shiki/dist/themes/github-light-default.mjs'),
]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme]) =>
  createHighlighterCore({
    themes: [theme.default],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }),
);

export function normalizeLanguage(language: string) {
  return LANGUAGE_ALIASES[language] || language;
}

export async function highlightCode(code: string, language: string): Promise<TokensResult | null> {
  const normalized = normalizeLanguage(language);
  const load = LANGUAGE_LOADERS[normalized];
  if (!load) return null;

  const instance = await highlighter;
  if (!instance.getLoadedLanguages().includes(normalized)) {
    const module = await load();
    await instance.loadLanguage(...module.default);
  }

  return instance.codeToTokens(code, { lang: normalized, theme: 'github-light-default' });
}
