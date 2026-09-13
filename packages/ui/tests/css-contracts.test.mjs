import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const pkgRoot = join(import.meta.dirname, '..');
const srcRoot = join(pkgRoot, 'src');

const APP_SELECTOR_DENYLIST = [
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
  'styles/markdown-body.css',
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

test('package stylesheet entry order is tokens → theme → motion → primitives → extra → markdown-body', () => {
  const entry = read(join(srcRoot, 'styles', 'index.css'));
  assert.match(
    entry,
    /@import '\.\/tokens\.css';\s*@import '\.\/theme\.css';\s*@import '\.\/motion\.css';\s*@import '\.\/primitives\.css';\s*@import '\.\/extra\.css';\s*@import '\.\/markdown-body\.css';/s,
  );
});

test('markdown-body.css uses Peri compact chat typeset', () => {
  const markdown = read(join(srcRoot, 'styles', 'markdown-body.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(markdown, /\.markdown-body\s*\{/);
  assert.match(markdown, /\.markdown-body\s*\{[^}]*font-size:\s*var\(--text-14\)/s);
  assert.match(markdown, /\.markdown-body\s*\{[^}]*display:\s*flex/s);
  assert.match(markdown, /gap:\s*var\(--chat-markdown-rhythm\)/);
  assert.match(markdown, /font-size:\s*var\(--text-18\)/);
  assert.match(markdown, /\.markdown-body > \* \+ :where\(h1, h2, h3, h4\)/);
  assert.doesNotMatch(markdown, /@layer\s+/);
  assert.doesNotMatch(markdown, /--ms-flow-paragraph-y:/);
  assert.doesNotMatch(markdown, /:last-child|:first-child/);
  assert.doesNotMatch(markdown, /\.typeset\b/);
});

test('theme.css is the only Tailwind import and sources package T2', () => {
  const theme = read(join(srcRoot, 'styles', 'theme.css'));
  const tailwindImports = [...theme.matchAll(/@import\s+'tailwindcss'/g)];
  assert.equal(tailwindImports.length, 1);
  assert.match(theme, /@source '\.\.\/components'/);
  assert.match(theme, /@source '\.\.\/lib'/);
  assert.match(theme, /@source '\.\.\/\.\.\/\.\.\/markdown\/src'/);
  assert.match(theme, /--color-neutral-25: var\(--palette-neutral-25\)/);
  for (const file of cssFiles().filter((path) => !path.endsWith('theme.css'))) {
    assert.doesNotMatch(read(file), /@import\s+'tailwindcss'/);
  }
});

test('Terminal package owns the xterm base stylesheet', () => {
  const extra = read(join(srcRoot, 'styles', 'extra.css'));
  assert.equal([...extra.matchAll(/@import\s+['"]@xterm\/xterm\/css\/xterm\.css['"]/g)].length, 1);
});

const selectorUsesAppPrefix = (selector, needle) => {
  // Package-owned ui-<app>-* selectors are allowed (e.g. ui-git-graph-, ui-composer-).
  if (selector.includes(`ui-${needle}`)) {
    return false;
  }
  if (needle === 'message-') {
    return /\.message-/.test(selector);
  }
  return selector.includes(needle);
};

test('package CSS does not own application selectors', () => {
  const selectors = cssFiles().flatMap((file) => cssSelectors(read(file)));
  for (const needle of APP_SELECTOR_DENYLIST) {
    assert.equal(
      selectors.some((selector) => selectorUsesAppPrefix(selector, needle)),
      false,
      `package CSS still contains ${needle} selector`,
    );
  }
  const css = cssFiles().map(read).join('\n');
  for (const selector of TERMINAL_ALLOWLIST) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(css, /\.terminal-workbench-park/);
});

test('standalone safe-area tokens are the only inset source for named utilities', () => {
  const tokens = read(join(srcRoot, 'styles', 'tokens.css'));
  const theme = read(join(srcRoot, 'styles', 'theme.css'));
  for (const name of ['top', 'right', 'bottom', 'left']) {
    assert.match(tokens, new RegExp(`--safe-area-${name}:\\s*env\\(safe-area-inset-${name}`));
  }
  assert.match(tokens, /--composer-safe-bottom:\s*calc\(var\(--space-20\) \+ var\(--safe-area-bottom\)\)/);
  for (const utility of ['pt-safe', 'pr-safe', 'pb-safe', 'pl-safe', 'px-safe', 'py-safe', 'p-safe']) {
    assert.match(theme, new RegExp(`@utility ${utility} \\{`));
  }
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

test('sidebar, transcript, and file-tree layout classes live in layout modules', () => {
  const sidebarLayout = read(join(srcRoot, 'components', 'sidebar', 'sidebar-layout.ts'));
  const rowAccessoryLayout = read(join(srcRoot, 'components', 'sidebar', 'row-accessory-layout.ts'));
  const transcriptLayout = read(join(srcRoot, 'components', 'transcript', 'transcript-layout.ts'));
  const fileTreeLayout = read(join(srcRoot, 'components', 'resource', 'file-tree-layout.ts'));
  assert.match(sidebarLayout, /bg-sidebar-scroll-mist/);
  assert.match(rowAccessoryLayout, /row-accessory-fade-cover/);
  assert.match(transcriptLayout, /grid-cols-boundary/);
  assert.match(fileTreeLayout, /fileTreeDropRootClass/);
  const extra = read(join(srcRoot, 'styles', 'extra.css'));
  assert.doesNotMatch(extra, /\.ui-sidebar-/);
  assert.doesNotMatch(extra, /\.ui-row-accessory-/);
  assert.doesNotMatch(extra, /\.ui-transcript-scroll\b/);
  assert.doesNotMatch(extra, /\.ui-transcript-history-boundary\b/);
  assert.doesNotMatch(extra, /\.ui-transcript-row\b/);
  assert.doesNotMatch(extra, /\.file-tree-row--drop-target\b/);
  assert.doesNotMatch(extra, /\.file-tree-drop-accent\b/);
  assert.doesNotMatch(extra, /\.explorer-upload-tree--drop-root\b/);
  assert.doesNotMatch(extra, /\.file-tree-inline-name-input\b/);
  assert.doesNotMatch(extra, /\.ui-file-tree-inline-row--invalid\b/);
});

test('git graph layout classes live in git-graph-layout.ts', () => {
  const layout = read(join(srcRoot, 'components', 'git-graph', 'git-graph-layout.ts'));
  assert.match(layout, /gitGraphPanelClass/);
  assert.match(layout, /h-\(--git-graph-row-height\)/);
  assert.match(layout, /max-compact:hidden/);
  assert.match(layout, /max-desk:hidden/);
  const extra = read(join(srcRoot, 'styles', 'extra.css'));
  assert.doesNotMatch(extra, /\.ui-git-graph-/);
});

test('composer layout classes live in composer-layout.ts', () => {
  const composerLayout = read(join(srcRoot, 'components', 'composer', 'composer-layout.ts'));
  const extra = read(join(srcRoot, 'styles', 'extra.css'));
  assert.match(composerLayout, /composerSurfaceBaseClass/);
  assert.match(composerLayout, /overflow-visible/);
  assert.match(composerLayout, /composerSlashOverlayClass/);
  assert.match(composerLayout, /w-\(--container-slash-menu\)/);
  assert.match(composerLayout, /composerSlashPopoverClass/);
  assert.match(composerLayout, /composerSurfaceFieldSlotCompactClass/);
  assert.match(composerLayout, /flex-1/);
  assert.match(composerLayout, /composerSurfaceTrailingClass/);
  assert.match(composerLayout, /composerEditorClass/);
  assert.match(composerLayout, /composerShellClass/);
  assert.match(composerLayout, /mx-auto/);
  assert.match(composerLayout, /composerPlusBtnClass/);
  assert.match(composerLayout, /bg-transparent/);
  assert.match(composerLayout, /composerEditorHintClass/);
  assert.match(composerLayout, /text-content-muted/);
  assert.match(composerLayout, /placeholder:text-content-muted/);
  assert.match(composerLayout, /composerMetaRowClass/);
  assert.match(composerLayout, /min-h-28/);
  assert.match(composerLayout, /composerMetaChipClass/);
  assert.match(composerLayout, /text-content-secondary/);
  assert.match(composerLayout, /max-w-144/);
  assert.doesNotMatch(extra, /\.ui-composer-meta-chip\s*\{/);
  assert.doesNotMatch(extra, /\.ui-composer-shell\s*\{/);
  assert.doesNotMatch(extra, /\.ui-composer-surface-v2\s*\{/);
  assert.doesNotMatch(extra, /\.ui-queue\s*\{/);
  assert.doesNotMatch(extra, /\.ui-attachment-list\s*\{/);
  assert.doesNotMatch(extra, /\.ui-composer-editor\s*\{/);
  assert.match(extra, /\.ui-composer-slash-popover \.overflow-hidden\.rounded-xl/s);
  assert.match(extra, /\.ui-composer-skills::before/s);
  const chatLayout = read(join(srcRoot, 'components', 'chat', 'chat-layout.ts'));
  assert.match(chatLayout, /overflow-visible/);
  assert.match(chatLayout, /bg-composer-fade/);
  assert.match(chatLayout, /max-h-\(--container-composer-stack-max\)/);
  const workbenchLayout = read(join(srcRoot, 'components', 'workbench', 'workbench-layout.ts'));
  assert.match(workbenchLayout, /top-\(--workbench-panel-inset-block\)/);
  assert.match(workbenchLayout, /bottom-\(--workbench-panel-inset-bottom\)/);
  assert.match(workbenchLayout, /bg-neutral-25/);
  assert.match(workbenchLayout, /workbenchPanelChromeHeaderClass[\s\S]*bg-surface-overlay/);
  assert.doesNotMatch(extra, /\.ui-workbench-floating-panel\s*\{/);
  assert.match(extra, /\.ui-terminal-dock-viewport:focus-within/s);
  assert.match(extra, /\.ui-workbench-rail-button--active-left::before/s);
  assert.match(extra, /body\.ui-workbench-panel-resizing/s);
  assert.doesNotMatch(extra, /\.ui-status-area-shell\s*\{/);
  assert.doesNotMatch(extra, /\.ui-terminal-dock-shell\s*\{/);
  assert.doesNotMatch(extra, /\.ui-rewind-panel__state\s*\{/);
  assert.doesNotMatch(extra, /\.ui-decision-queue-shell\s*\{/);
  assert.doesNotMatch(extra, /\.ui-workbench-shell\s*\{/);
  assert.match(chatLayout, /px-48 desk:max-wide:px-40 max-narrow:px-24/);
  const chatActivityChain = read(join(srcRoot, 'components', 'chat', 'ChatActivityChain.tsx'));
  assert.match(chatActivityChain, /gap-16/);
  assert.match(chatActivityChain, /left-\(--chat-activity-rail-left\)/);
});

test('extra.css does not keep legacy ui-* alias selectors', () => {
  const extra = read(join(srcRoot, 'styles', 'extra.css'));
  assert.doesNotMatch(extra, /\.ui-chat-/);
  assert.doesNotMatch(extra, /\.chat-column\s*\{/);
  assert.doesNotMatch(extra, /\.history-boundary\s*\{/);
  assert.doesNotMatch(extra, /\.transcript-row\s*\{/);
});

test('overlay motion recipes are defined', () => {
  const motion = read(join(srcRoot, 'styles', 'motion.css'));
  for (const utility of [
    'ui-overlay-scrim-motion',
    'ui-modal-dialog-motion',
    'ui-surface-popover-motion',
    'ui-menu-surface-motion',
    'ui-panel-sheet-motion',
    'ui-toast-motion',
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
