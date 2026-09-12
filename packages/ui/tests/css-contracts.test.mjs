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
  'styles/motion.css',
  'styles/primitives.css',
  'styles/extra.css',
  'styles/typeset.css',
  'styles/utilities.css',
].map((file) => join(srcRoot, file));

const SCROLL_FADE_UTILITIES = [
  'scroll-fade',
  'scroll-fade-y',
  'scroll-fade-x',
  'scroll-fade-t',
  'scroll-fade-b',
  'scroll-fade-l',
  'scroll-fade-r',
  'scroll-fade-s',
  'scroll-fade-e',
];

const SHIMMER_UTILITIES = [
  'shimmer',
  'shimmer-once',
  'shimmer-reverse',
  'shimmer-none',
];

const ARBITRARY_TAILWIND_LITERAL = /(?<![\w-])-\[[^\]]+\]/;
const HEX_COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b/;

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

test('package stylesheet entry order is tokens → theme → motion → primitives → extra → typeset', () => {
  const entry = read(join(srcRoot, 'styles', 'index.css'));
  assert.match(
    entry,
    /@import '\.\/tokens\.css';\s*@import '\.\/theme\.css';\s*@import '\.\/motion\.css';\s*@import '\.\/primitives\.css';\s*@import '\.\/extra\.css';\s*@import '\.\/typeset\.css';/s,
  );
});

test('typeset.css defines streaming-safe markdown typography', () => {
  const typeset = read(join(srcRoot, 'styles', 'typeset.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(typeset, /\.typeset\b/);
  assert.match(typeset, /\.typeset-chat\b/);
  assert.match(typeset, /\.typeset-scroll\b/);
  assert.match(typeset, /\.not-typeset\b/);
  assert.match(typeset, /container-type:\s*inline-size/);
  assert.match(typeset, /\.typeset > \* \+ \*/);
  assert.doesNotMatch(typeset, /:last-child|:first-child/);
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

test('extra.css imports scroll-fade and shimmer utilities', () => {
  const extra = read(join(srcRoot, 'styles', 'extra.css'));
  assert.match(extra, /@import '\.\/utilities\.css';/);
});

test('overlay motion recipes are defined', () => {
  const motion = read(join(srcRoot, 'styles', 'motion.css'));
  for (const utility of [
    'ui-overlay-scrim-motion',
    'ui-modal-dialog-motion',
    'ui-surface-popover-motion',
    'ui-menu-surface-motion',
    'ui-panel-sheet-motion',
    'animate-in',
    'animate-out',
  ]) {
    assert.match(motion, new RegExp(`\\.${utility}\\b`), `missing .${utility} motion utility`);
  }
  assert.match(motion, /@media \(prefers-reduced-motion: reduce\)/);
});

test('scroll-fade and shimmer utility classes are defined', () => {
  const utilities = read(join(srcRoot, 'styles', 'utilities.css'));
  for (const utility of [...SCROLL_FADE_UTILITIES, ...SHIMMER_UTILITIES]) {
    assert.match(utilities, new RegExp(`\\.${utility}\\b`), `missing .${utility} utility`);
  }
  assert.match(utilities, /@supports \(animation-timeline: scroll\(\)\)/);
  assert.match(utilities, /@supports not \(animation-timeline: scroll\(\)\)/);
  assert.match(utilities, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(utilities, /background-clip:\s*text/);
  assert.match(utilities, /mask-image:/);
});

test('utility CSS does not use bracket literals or hex colors', () => {
  const utilities = read(join(srcRoot, 'styles', 'utilities.css'));
  const withoutComments = utilities.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(withoutComments, ARBITRARY_TAILWIND_LITERAL);
  assert.doesNotMatch(withoutComments, HEX_COLOR_LITERAL);
});
