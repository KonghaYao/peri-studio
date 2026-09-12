import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const pkgRoot = join(import.meta.dirname, '..');
const srcRoot = join(pkgRoot, 'src');

const APP_SELECTOR_DENYLIST = [
  'markdown-body',
  'rewind-',
  'composer-',
  'sidebar-',
  'mcp-',
  'message-',
  'topology-',
  'workbench-',
  'resource-',
  'git-graph-',
];
const TERMINAL_ALLOWLIST = [
  '.terminal-xterm-host',
  '.terminal-xterm-host .xterm',
  '.terminal-xterm-host .xterm-viewport',
  '.terminal-xterm-host .xterm-screen',
  '.terminal-xterm-host .xterm-screen canvas',
  '.terminal-xterm-host .xterm-link',
];
const ARBITRARY_SIZING_UTILITY = /(?<![\w-])(?:(?:[a-z][\w-]*|max-desk|max-narrow|max-tight|desk|wide|compact|pointer-coarse):)*-?(?:(?:w|h|min-w|max-w|min-h|max-h|size|top|right|bottom|left|inset(?:-x|-y)?|gap(?:-x|-y)?|p[trblxy]?|m[trblxy]?)|shadow|tracking)-\[([^\]]+)\]/g;
const ARBITRARY_BREAKPOINT_VARIANT = /(?<![\w-])(?:min|max)-\[[^\]]+\]:/g;

const allFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
  const path = join(directory, item.name);
  return item.isDirectory() ? allFiles(path) : [path];
});

const cssFiles = () => [
  'styles/index.css',
  'styles/tokens.css',
  'styles/theme.css',
  'styles/primitives.css',
  'styles/extra.css',
].map((file) => join(srcRoot, file));

const cssSelectors = (source) => {
  const selectors = [];
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let preludeStart = 0;
  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (character === '{') {
      const prelude = withoutComments.slice(preludeStart, index).trim();
      if (prelude && !prelude.startsWith('@')) selectors.push(prelude);
      preludeStart = index + 1;
    } else if (character === '}' || character === ';') {
      preludeStart = index + 1;
    }
  }
  return selectors;
};

const read = (file) => readFileSync(file, 'utf8');

test('package stylesheet entry order is tokens → theme → primitives → extra', () => {
  const entry = read(join(srcRoot, 'styles', 'index.css'));
  assert.match(entry, /@import '\.\/tokens\.css';\s*@import '\.\/theme\.css';\s*@import '\.\/primitives\.css';\s*@import '\.\/extra\.css';/s);
});

test('theme.css is the only Tailwind import and sources package T2', () => {
  const theme = read(join(srcRoot, 'styles', 'theme.css'));
  const tailwindImports = [...theme.matchAll(/@import\s+'tailwindcss'/g)];
  assert.equal(tailwindImports.length, 1);
  assert.match(theme, /@source '\.\.\/components'/);
  assert.match(theme, /@source '\.\.\/lib'/);
  for (const file of cssFiles().filter((path) => !path.endsWith('theme.css'))) {
    assert.doesNotMatch(read(file), /@import\s+'tailwindcss'/);
  }
});

test('Terminal package owns the xterm base stylesheet', () => {
  const extra = read(join(srcRoot, 'styles', 'extra.css'));
  assert.equal([...extra.matchAll(/@import\s+['"]@xterm\/xterm\/css\/xterm\.css['"]/g)].length, 1);
});

test('package CSS does not own application selectors', () => {
  const selectors = cssFiles().flatMap((file) => cssSelectors(read(file)));
  for (const needle of APP_SELECTOR_DENYLIST) {
    assert.equal(selectors.some((selector) => selector.includes(needle)), false, `package CSS still contains ${needle} selector`);
  }
  const css = cssFiles().map(read).join('\n');
  for (const selector of TERMINAL_ALLOWLIST) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(css, /\.terminal-workbench-park/);
});

test('package CSS only consumes declared tokens', () => {
  const tokens = read(join(srcRoot, 'styles', 'tokens.css'));
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const used = new Set(
    cssFiles()
      .filter((path) => !path.endsWith('tokens.css'))
      .flatMap((file) => [...read(file).matchAll(/var\((--[\w-]+)/g)].map((match) => match[1])),
  );
  assert.deepEqual([...used].filter((token) => !defined.has(token)).sort(), []);
});

test('T2 sources do not use arbitrary Tailwind bracket utilities', () => {
  const offenders = allFiles(srcRoot)
    .filter((path) => /\.(?:ts|tsx)$/.test(path) && !path.endsWith('.test.tsx') && !path.endsWith('.test.ts'))
    .flatMap((path) => {
      const source = read(path);
      const hits = [];
      for (const match of source.matchAll(ARBITRARY_SIZING_UTILITY)) hits.push(match[0].trim());
      for (const match of source.matchAll(ARBITRARY_BREAKPOINT_VARIANT)) hits.push(match[0].trim());
      return hits.map((token) => `${path.slice(srcRoot.length + 1)}: ${token}`);
    });
  assert.deepEqual(offenders, []);
});

test('package source does not import web, sandbox, store, protocol, Yjs, or server modules', () => {
  const forbidden = /from\s+['"](?:@\/|web\/|ui-sandbox\/|@\/store|@\/shared\/(?:protocol|yjs))/;
  const offenders = allFiles(srcRoot)
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .filter((path) => forbidden.test(read(path)))
    .map((path) => path.slice(srcRoot.length + 1));
  assert.deepEqual(offenders, []);
});

test('duplicate component tests and consumer T2 copies are gone', () => {
  assert.equal(existsSync(join(srcRoot, 'components', 'components.test.tsx')), false);
});
