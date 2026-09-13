// CSS 与 UI 视觉系统契约（node:test）：CSS 结构/token/媒体查询断言，
// 以及特性组件对 UI 库的消费边界（barrel 出口、SVG 画布、按钮行为、色彩、
// Badge/Tooltip/Drawer 视觉委托）。按主题从原 state-contracts 拆分而来，
// 断言意图与原文件一致。

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { transform } from 'lightningcss';
import postcss from 'postcss';

const webRoot = () => join(import.meta.dirname, '..');

// styles.css is the cascade entry now: it imports styles/base.css, @peri/ui/styles.css,
// styles/primitives.css and styles/extra.css. Feature assertions run against local
// stylesheets; package CSS（含 xterm 基础样式）由 packages/ui tests 负责。
const cssFiles = () => {
  const source = join(webRoot(), 'src');
  const entry = readFileSync(join(source, 'styles.css'), 'utf8');
  return [...entry.matchAll(/@import\s+'([^']+)';/g)]
    .map((match) => match[1].replace(/^\.\//, ''))
    .filter((specifier) => !specifier.startsWith('@'));
};
const featureCss = () => cssFiles().map((file) => readFileSync(join(webRoot(), 'src', file), 'utf8')).join('\n');
const sourceRoot = () => join(import.meta.dirname, '..', 'src');
const widgetComponentRoots = () => [
  'widgets/shell',
  'widgets/chat',
  'widgets/auth',
  'widgets/resource',
  'widgets/composer',
  'widgets/sidebar',
].map((segment) => join(sourceRoot(), segment));
const listWidgetTsx = (predicate = () => true) => widgetComponentRoots().flatMap((root) => {
  const entries = existsSync(root) ? readdirSync(root, { withFileTypes: true }) : [];
  return entries
    .filter((item) => item.isFile() && item.name.endsWith('.tsx') && predicate(item.name))
    .map((item) => join(root, item.name));
});
const readWidgetTsx = (name) => {
  const path = listWidgetTsx((file) => file === name)[0];
  assert.ok(path, `missing widget component ${name}`);
  return readFileSync(path, 'utf8');
};
const readComposerBundle = () => {
  const dir = join(sourceRoot(), 'widgets', 'composer');
  const pkgComposer = join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'composer');
  const pkgStyles = join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'styles', 'extra.css');
  const webExtra = readFileSync(join(webRoot(), 'src', 'styles', 'extra.css'), 'utf8');
  return [
    ...['Composer.tsx', 'useComposerState.ts']
      .map((file) => readFileSync(join(dir, file), 'utf8')),
    webExtra,
    readFileSync(join(pkgComposer, 'ComposerShell.tsx'), 'utf8'),
    readFileSync(join(pkgComposer, 'ComposerToolbarShell.tsx'), 'utf8'),
    readFileSync(join(pkgComposer, 'ComposerInputField.tsx'), 'utf8'),
    readFileSync(join(pkgComposer, 'ComposerToolbarControls.tsx'), 'utf8'),
    readFileSync(pkgStyles, 'utf8'),
  ].join('\n');
};
const allFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
  const path = join(directory, item.name);
  return item.isDirectory() ? allFiles(path) : [path];
});
const listWidgetSourceTsx = () => {
  const widgetsRoot = join(sourceRoot(), 'widgets');
  return existsSync(widgetsRoot)
    ? allFiles(widgetsRoot).filter((path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx'))
    : [];
};
const ARBITRARY_SIZING_UTILITY = /(?<![\w-])(?:(?:[a-z][\w-]*|max-desk|max-narrow|max-tight|desk|wide|compact|pointer-coarse):)*-?(?:(?:w|h|min-w|max-w|min-h|max-h|size|top|right|bottom|left|inset(?:-x|-y)?|gap(?:-x|-y)?|p[trblxy]?|m[trblxy]?)|shadow|tracking)-\[([^\]]+)\]/g;
const ARBITRARY_BREAKPOINT_VARIANT = /(?<![\w-])(?:min|max)-\[[^\]]+\]:/g;
const findArbitraryBracketViolations = (source) => {
  const violations = new Set();
  for (const match of source.matchAll(ARBITRARY_SIZING_UTILITY)) {
    violations.add(match[0].trim());
  }
  for (const match of source.matchAll(ARBITRARY_BREAKPOINT_VARIANT)) {
    violations.add(match[0].trim());
  }
  return [...violations];
};
const ARBITRARY_SELECTOR_BRACKET = /\[&[^\]]+\]/g;
const WIDGET_ARBITRARY_SELECTOR_ALLOWLIST = new Set();
const listLayerSourceFiles = (layerDirs) => layerDirs.flatMap((segment) => {
  const layerRoot = join(sourceRoot(), segment);
  if (!existsSync(layerRoot)) return [];
  return allFiles(layerRoot).filter((path) => (
    (path.endsWith('.tsx') || path.endsWith('.ts'))
    && !path.endsWith('.test.tsx')
    && !path.endsWith('.test.ts')
  ));
});
const relativeFromSrc = (absolutePath) => absolutePath.slice(sourceRoot().length + 1);

test('widgets must not use arbitrary tailwind bracket utilities', () => {
  const offenders = listWidgetSourceTsx().flatMap((path) => {
    const rel = relativeFromSrc(path);
    const violations = findArbitraryBracketViolations(readFileSync(path, 'utf8'));
    return violations.map((token) => `${rel}: ${token}`);
  });
  assert.deepEqual(offenders, []);
});

test('widgets must not use arbitrary selector bracket utilities except tracked legacy', () => {
  const offenders = listWidgetSourceTsx().flatMap((path) => {
    const rel = relativeFromSrc(path);
    if (WIDGET_ARBITRARY_SELECTOR_ALLOWLIST.has(rel)) return [];
    const hits = [...readFileSync(path, 'utf8').matchAll(ARBITRARY_SELECTOR_BRACKET)].map((match) => match[0]);
    return hits.map((token) => `${rel}: ${token}`);
  });
  assert.deepEqual(offenders, []);
});

test('features, pages, and app must not use arbitrary tailwind bracket utilities', () => {
  const offenders = listLayerSourceFiles(['features', 'pages', 'app']).flatMap((path) => {
    const rel = relativeFromSrc(path);
    const violations = findArbitraryBracketViolations(readFileSync(path, 'utf8'));
    return violations.map((token) => `${rel}: ${token}`);
  });
  assert.deepEqual(offenders, []);
});

test('consumer T2 copies are gone and consumers use public package exports', () => {
  const sandboxRoot = join(webRoot(), '..', 'ui-sandbox', 'src');
  const removedPaths = [
    join(sourceRoot(), 'shared', 'ui'),
    join(sourceRoot(), 'styles', 'tokens.css'),
    join(sourceRoot(), 'styles', 'theme.css'),
    join(sandboxRoot, 'components', 'ui'),
    join(sandboxRoot, 'styles', 'tokens.css'),
    join(sandboxRoot, 'styles', 'theme.css'),
  ];
  for (const path of removedPaths) assert.equal(existsSync(path), false, `${path} must stay removed`);

  const consumerSources = [sourceRoot(), sandboxRoot].flatMap(allFiles);
  const legacy = consumerSources
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .filter((path) => /@\/shared\/ui|@\/shared\/lib\/cn|@\/components\/ui/.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(join(webRoot(), '..').length + 1));
  assert.deepEqual(legacy, []);

  const deepComponentImports = consumerSources
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .filter((path) => /from\s+['"]@peri\/ui\//.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(join(webRoot(), '..').length + 1));
  assert.deepEqual(deepComponentImports, []);

  const allowedStyleExports = new Set(['@peri/ui/styles.css', '@peri/ui/tokens.css']);
  const undeclaredPackageSubpaths = consumerSources
    .filter((path) => /\.(?:ts|tsx|css)$/.test(path))
    .flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/['"](@peri\/ui\/[^'"]+)['"]/g)]
      .filter((match) => !allowedStyleExports.has(match[1]))
      .map((match) => `${path.slice(join(webRoot(), '..').length + 1)}: ${match[1]}`));
  assert.deepEqual(undeclaredPackageSubpaths, []);
});

test('fractional Tailwind spacing utilities resolve to an explicit product token', () => {
  const source = join(import.meta.dirname, '..', 'src');
  const files = [];
  const walk = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.(?:ts|tsx|css)$/.test(item.name)) files.push(path);
    }
  };
  walk(source);
  const used = new Set();
  const utility = /(?:^|[\s:"`])(?:-?(?:m|p)[trblxy]?|gap(?:-x|-y)?|top|right|bottom|left|inset(?:-x|-y)?)-(\d+\.\d+)(?=[^\d]|$)/g;
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(utility)) used.add(match[1]);
  }
  const theme = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'styles', 'theme.css'), 'utf8');
  const declared = new Set([...theme.matchAll(/--spacing-(\d+\.\d+)\s*:/g)].map((match) => match[1]));
  assert.deepEqual([...used].filter((token) => !declared.has(token)).sort(), []);
});

const EXTRA_CSS_BASELINE = {
  lineCount: 1,
  sha256: '75a119dd871f246d1e47fdea100863eb088f2056bcb6c32b1bc4ad4b86576ff0',
};

function lineCountLikeWc(content) {
  if (content.length === 0) return 0;
  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === '') return lines.length - 1;
  return lines.length;
}

test('extra.css stays at the WP-BOUND line and hash baseline until intentionally revised', () => {
  const extraPath = join(webRoot(), 'src', 'styles', 'extra.css');
  const content = readFileSync(extraPath, 'utf8');
  const lineCount = lineCountLikeWc(content);
  const sha256 = createHash('sha256').update(content).digest('hex');
  assert.equal(lineCount, EXTRA_CSS_BASELINE.lineCount, 'extra.css line count grew; revise baseline in css-contracts or move rules to tokens/Tailwind');
  assert.equal(sha256, EXTRA_CSS_BASELINE.sha256, 'extra.css content changed; update EXTRA_CSS_BASELINE.sha256 when the change is intentional');
});

test('styles entry imports extra.css for non-utility exceptions', () => {
  const entry = readFileSync(join(import.meta.dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(entry, /@import\s+'\.\/styles\/extra\.css';/);
});

test('numeric Tailwind spacing utilities resolve to an explicit product token', () => {
  const source = join(import.meta.dirname, '..', 'src');
  const files = [];
  const walk = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.(?:ts|tsx|css)$/.test(item.name)) files.push(path);
    }
  };
  walk(source);
  const used = new Set();
  const utility = /(?:^|[\s:"`])(?:-?m[trblxy]?|-?p[trblxy]?|gap|[wh]|min-[wh]|max-[wh]|size|top|right|bottom|left)-(\d+)(?=[^\dA-Za-z_.-]|$)/g;
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(utility)) used.add(match[1]);
  }
  const theme = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'styles', 'theme.css'), 'utf8');
  const declared = new Set([...theme.matchAll(/--spacing-(\d+)\s*:/g)].map((match) => match[1]));
  assert.deepEqual([...used].filter((token) => token !== '0' && !declared.has(token)).sort((left, right) => Number(left) - Number(right)), []);
});

test('source stylesheets are structurally valid and consume only declared design tokens', () => {
  const source = join(import.meta.dirname, '..', 'src');
  const files = ['styles.css', 'styles/base.css', 'styles/primitives.css', 'styles/extra.css'];
  const stylesheets = files.filter((file) => file !== 'styles/tokens.css');
  const roots = files.map((file) => {
    const css = readFileSync(join(source, file), 'utf8');
    const strict = transform({ filename: file, code: Buffer.from(css), errorRecovery: false });
    assert.deepEqual(strict.warnings, [], `${file} has strict-parser warnings`);
    return postcss.parse(css, { from: file });
  });
  for (const root of roots) {
    root.walkAtRules('media', (media) => {
      const directDeclarations = (media.nodes || []).filter((node) => node.type === 'decl');
      assert.deepEqual(directDeclarations.map((decl) => `${decl.source?.start?.line}:${decl.prop}`), [], `${media.source?.input.file} has declarations outside a rule`);
    });
  }
  const tokenSource = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');
  const defined = new Set([...tokenSource.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const used = new Set(stylesheets.flatMap((file) => [...readFileSync(join(source, file), 'utf8').matchAll(/var\((--[\w-]+)/g)].map((match) => match[1])));
  assert.deepEqual([...used].filter((token) => !defined.has(token)).sort(), []);
});

test('Kobalte dialog composes an independently layered portal overlay and content', () => {
  const dialog = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Dialog.tsx'), 'utf8');
  assert.match(dialog, /return <DialogPrimitive\.Portal \{\.\.\.props\} \/>;/);
  assert.match(
    dialog,
    /<DialogOverlay class=\{local\.overlayClass\} \/>\s*<DialogPrimitive\.Content/s,
  );
  assert.match(dialog, /DialogPrimitive\.Overlay[\s\S]*?data-dialog-overlay[\s\S]*?class=\{cn\('fixed inset-0 z-60 bg-scrim'/);
  assert.match(dialog, /const isSheet = \(\) => local\.size === 'resource-compact'/);
  assert.match(dialog, /const isRewind = \(\) => local\.size === 'rewind'/);
  assert.match(dialog, /rewindDialogContentClass/);
  assert.match(dialog, /top-1\/2 left-1\/2 -translate-x-1\/2 -translate-y-1\/2/);
  assert.match(dialog, /'w-\(--container-dialog-default\) max-h-\(--container-dialog-tall\)/);
  assert.match(dialog, /onEscapeKeyDown=\{preventWhenLocked\}/);
  assert.match(dialog, /onPointerDownOutside=\{preventWhenLocked\}/);
});

test('dialog size belongs to DialogContent rather than an overflowing child', () => {
  const dialog = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Dialog.tsx'), 'utf8');
  const dialogConsumers = listWidgetTsx()
    .map((path) => [path, readFileSync(path, 'utf8')])
    .filter(([, code]) => code.includes('<DialogContent'));
  assert.match(dialog, /type DialogSize = 'default' \| 'search' \| 'settings' \| 'mcp' \| 'resource-compact' \| 'rewind'/);
  for (const [file, code] of dialogConsumers) {
    assert.doesNotMatch(code, /<DialogContent[\s\S]{0,300}(?:w-|min-w-)\(--container-/, `${file} puts viewport width inside DialogContent`);
  }
});

test('Composer and quick start expose one labeled textarea and keyboard submit guidance', () => {
  const root = join(import.meta.dirname, '..', 'src', 'widgets', 'composer');
  const composerShell = readFileSync(join(root, 'Composer.tsx'), 'utf8');
  const quickStart = readFileSync(join(root, 'QuickStartComposer.tsx'), 'utf8');
  assert.match(composerShell, /<ComposerInputField[\s\S]*?aria-label="Message the agent"/);
  assert.match(composerShell, /aria-autocomplete="list"/);
  assert.match(composerShell, /if \(e\.key === 'Enter' && !e\.shiftKey\) \{\s*e\.preventDefault\(\);\s*props\.state\.submit\(\);/);
  assert.match(quickStart, /<ComposerInputField[\s\S]*?aria-label="First message"/);
  assert.match(quickStart, /ComposerSendStopAction/);
  assert.match(quickStart, /if \(event\.key === 'Enter' && !event\.shiftKey\) \{\s*event\.preventDefault\(\);\s*props\.onSubmit\(\);/);
  assert.doesNotMatch(composerShell, /shadow-float/);
  assert.doesNotMatch(quickStart, /shadow-float/);
});

test('feature components consume the Solid UI library only through its public barrel', () => {
  const offenders = listWidgetTsx()
    .filter((path) => /from\s+['"]\.\.\/\.\.\/ui\//.test(readFileSync(path, 'utf8')))
    .map((path) => path.split('/').pop());
  assert.deepEqual(offenders, []);
});

test('feature-owned SVG geometry always uses the shared finite icon canvas', () => {
  const offenders = listWidgetTsx()
    .filter((path) => /<svg\b/.test(readFileSync(path, 'utf8')))
    .map((path) => path.split('/').pop());
  assert.deepEqual(offenders, []);
  const icon = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Icon.tsx'), 'utf8');
  assert.match(icon, /<svg/);
  assert.match(icon, /viewBox="0 0 20 20"/);
  assert.match(icon, /aria-hidden="true"/);
  assert.match(icon, /fill="none"/);
  assert.match(icon, /stroke="currentColor"/);
});

test('high-frequency chat controls are owned by the Solid UI library', () => {
  const composer = readFileSync(join(sourceRoot(), 'widgets', 'composer', 'Composer.tsx'), 'utf8');
  const messageList = readWidgetTsx('MessageList.tsx');
  assert.doesNotMatch(composer, /<button\b/, 'Composer.tsx');
  assert.doesNotMatch(messageList, /<button\b/, 'MessageList.tsx');
});

test('MessageList delegates entry semantics through stable entry-id slots to one tested conversation component', () => {
  const list = readWidgetTsx('MessageList.tsx');
  const message = readWidgetTsx('ConversationMessage.tsx');
  assert.match(list, /const chatEntryIds = createMemo\(\(\) => chatEntries\(\)\.map\(\(entry\) => entry\.id\)\)/);
  assert.match(list, /<Show when=\{chatEntries\(\)\[globalIndex\(\)\]\}>\{\(entry\) =>/);
  assert.match(list, /<ConversationMessage\s+entry=\{entry\}\s+activityBoundary=\{\(\) => activityBoundaryAt\(chatEntries\(\), globalIndex\(\)\)\}\s+activityContinuation=\{\(\) => activityContinuationAt\(chatEntries\(\), globalIndex\(\)\)\}\s+terminalNoticeOwner=\{\(\) => isTurnTerminalNoticeOwner\(chatEntries\(\), globalIndex\(\)\)\}\s+\/>/);
  assert.match(list, /<PlanSystemEntryRow entry=\{entry\(\)\} \/>/);
  assert.doesNotMatch(list, /function MessageBubble|<Markdown|<ToolCallActivity/);
  assert.match(message, /<MessageArticleShell[\s\S]*from=\{role\(\)\}/);
  const articleShell = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'chat', 'MessageArticleShell.tsx'), 'utf8');
  assert.match(articleShell, /conversation-message--\$\{local\.from\}/);
  assert.match(message, /role="alert" aria-label="Message error"/);
});

test('the permission surface exposes a queue and never resolves an empty identity', () => {
  const messageList = readWidgetTsx('MessageList.tsx');
  const chatView = readWidgetTsx('ChatView.tsx');
  const queue = readWidgetTsx('PermissionQueue.tsx');
  const card = readWidgetTsx('PermissionRequestCard.tsx');
  assert.doesNotMatch(messageList, /<PermissionQueue/);
  assert.match(chatView, /<PermissionQueue/);
  assert.ok(chatView.indexOf('<PermissionQueue') < chatView.indexOf('<Composer '));
  assert.doesNotMatch(messageList, /permissions\(\)\[0\]/);
  assert.match(queue, /if \(id\) props\.onResolve\(id, decision, optionId\)/);
  assert.match(card, /primaryDisabled=\{primaryDisabled\(\)\}/);
  assert.match(card, /const unavailable = !actionable\(\)/);
});

test('the shared Button defaults to non-submitting behavior', () => {
  const button = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Button.tsx'), 'utf8');
  assert.match(button, /type=\{button\.type \?\? 'button'\}/);
});

test('feature-owned native buttons always state their form behavior', () => {
  const offenders = listWidgetTsx((file) => !file.endsWith('.test.tsx'))
    .flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/<button\b([^>]*)>/gs)]
      .filter((match) => !/\btype\s*=/.test(match[1]))
      .map(() => path.split('/').pop()));
  assert.deepEqual(offenders, []);
});

test('feature components never introduce literal colors', () => {
  const offenders = listWidgetTsx()
    .filter((path) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(readFileSync(path, 'utf8')))
    .map((path) => path.split('/').pop());
  assert.deepEqual(offenders, []);
});

test('large semantic status surfaces stay white', () => {
  const source = sourceRoot();
  const files = [
    join(webRoot(), '..', 'packages', 'ui', 'src', 'components', 'InlineNotice.tsx'),
    join(source, 'widgets', 'chat', 'MessageOutbox.tsx'),
    join(source, 'widgets', 'chat', 'PermissionQueue.tsx'),
    join(source, 'widgets', 'chat', 'PermissionRequestCard.tsx'),
    join(source, 'widgets', 'chat', 'RewindDialog.tsx'),
    join(source, 'widgets', 'chat', 'ToolCallActivity.tsx'),
    join(source, 'widgets', 'shell', 'shared', 'ConfirmDialog.tsx'),
  ];
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    assert.doesNotMatch(code, /bg-(?:warning|danger|success)-soft/, `${file} uses a tinted status canvas`);
  }
});

test('responsive behavior has compact, medium and wide layout contracts', () => {
  const root = sourceRoot();
  const shell = readWidgetTsx('AppShell.tsx');
  const drawer = readFileSync(join(root, 'widgets', 'shell', 'shared', 'ProjectDrawer.tsx'), 'utf8');
  const messageList = readWidgetTsx('MessageList.tsx');
  const composer = readFileSync(join(root, 'widgets', 'composer', 'Composer.tsx'), 'utf8');
  const theme = readFileSync(join(webRoot(), '..', 'packages', 'ui', 'src', 'styles', 'theme.css'), 'utf8');
  const breakpoints = readFileSync(join(root, 'shared', 'lib', 'breakpoints.ts'), 'utf8');
  assert.match(shell, /compactViewportQuery/);
  assert.doesNotMatch(shell, /max-width:\s*\d+px/);
  assert.match(breakpoints, /COMPACT_VIEWPORT_MAX\s*=\s*959/);
  assert.match(breakpoints, /MEDIUM_VIEWPORT_MAX\s*=\s*1199/);
  // Tailwind 断点映射：desk=960px（侧栏收窄 240px）/ wide=1200px（280px）
  assert.match(theme, /--breakpoint-desk:\s*960px/);
  assert.match(theme, /--breakpoint-wide:\s*1200px/);
  assert.match(shell, /grid-cols-shell/);
  assert.match(shell, /desk:grid-cols-shell-desk/);
  assert.match(shell, /wide:grid-cols-shell-wide/);
  assert.match(drawer, /<aside[^>]*class=\{drawerPanelClass\}/);
  assert.match(drawer, /<Dialog open=\{props\.open\}/);
  assert.match(drawer, /max-desk:fixed[^']*max-desk:w-\(--container-drawer\)/);
  // 正文与 Composer 共享 chatColumnClass 水平轨道。
  assert.match(messageList, /chatColumnClass/);
  assert.match(composer, /chatColumnClass/);
  assert.doesNotMatch(composer, /max-w-\(--container-chat\)/);
  assert.doesNotMatch(drawer, /project-drawer\s*\{[^}]*position\s*:\s*fixed/);
});

test('coarse pointers expose sidebar actions without hover and keep controls touch-sized', () => {
  const sessionRow = readFileSync(join(import.meta.dirname, '..', 'src', 'widgets', 'sidebar', 'ProjectSessionRow.tsx'), 'utf8');
  const sessionAccessory = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'RowAccessorySlot.tsx'), 'utf8');
  const button = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Button.tsx'), 'utf8');
  const dialog = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Dialog.tsx'), 'utf8');
  assert.match(sessionAccessory, /group-hover\/workspace:opacity-100/);
  assert.match(sessionAccessory, /group-hover\/row/);
  assert.match(sessionAccessory, /group-focus-within\/row/);
  assert.match(sessionAccessory, /pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto/);
  assert.match(sessionRow, /pointer-coarse:py-6/);
  assert.match(button, /pointer-coarse:min-h-44/);
  assert.match(button, /pointer-coarse:min-w-44/);
  assert.match(dialog, /as=\{IconButton\}/);
});

test('P0 interaction architecture cannot regress to hidden cancel or viewport-breaking overlays', () => {
  const composer = readComposerBundle();
  const sidebarChrome = readWidgetTsx('SidebarChrome.tsx');
  const projectSidebarShell = readFileSync(
    join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'sidebar', 'ProjectSidebarShell.tsx'),
    'utf8',
  );
  const dialog = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Dialog.tsx'), 'utf8');
  const styles = featureCss();
  assert.match(composer, /cancelTurn/);
  assert.match(composer, /Stop generation/);
  assert.match(composer, /control\?\.phase === 'uncertain'[\s\S]*?retryPersistentAction\(control\.commandId\)/);
  assert.match(composer, /Confirm stop with original request/);
  assert.match(dialog, /DialogPrimitive\.Portal/);
  assert.match(projectSidebarShell, /sidebar-footer/);
  assert.doesNotMatch(sidebarChrome, /Pull requests|Sites are not connected|Scheduled tasks|Plugin management|label="Voice"/);
  assert.doesNotMatch(styles, /logout-button[^}]*position\s*:\s*fixed/s);
});

test('composer keeps the writing surface quiet and keyboard behavior discoverable', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const composerShell = readFileSync(join(root, 'widgets', 'composer', 'Composer.tsx'), 'utf8');
  const composerParts = readComposerBundle();
  const base = readFileSync(join(root, 'styles', 'base.css'), 'utf8');
  assert.match(composerParts, /Enter to send · Shift \+ Enter for newline/);
  assert.match(composerParts, /runtimeSummary/);
  assert.doesNotMatch(composerShell, />\s*effort：/);
  assert.doesNotMatch(composerShell, />\s*上下文：/);
  assert.doesNotMatch(composerShell, /focus-within:border-focus-ring/);
  assert.doesNotMatch(composerShell, /has-\[\.composer-input:focus-visible\]:shadow-/);
  assert.doesNotMatch(composerShell, /shadow-float/);
  const composerLayout = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'composer', 'composer-layout.ts'), 'utf8');
  assert.match(composerLayout, /composerSurfaceBaseClass/);
  assert.match(composerLayout, /rounded-\(--composer-pill-radius\)/);
  assert.match(composerShell, /composerSlashOverlayClass/);
  assert.doesNotMatch(composerShell, /slash-menu absolute z-35 right-20 bottom-full left-20/);
  const composerControls = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'composer', 'ComposerToolbarControls.tsx'), 'utf8');
  const quickStartComposer = readFileSync(join(root, 'widgets', 'composer', 'QuickStartComposer.tsx'), 'utf8');
  assert.doesNotMatch(composerControls, /bg-accent-solid/);
  assert.match(composerControls, /'primary'/);
  assert.doesNotMatch(quickStartComposer, /bg-accent-solid/);
  assert.doesNotMatch(quickStartComposer, /Approval mode/);
  assert.match(quickStartComposer, /ComposerSendStopAction[\s\S]*?mode="send"/);
  assert.match(base, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\)/);
});

test('design tokens cannot directly reference themselves', () => {
  const css = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');
  const selfReferences = [...css.matchAll(/--([a-z0-9-]+)\s*:\s*var\(--\1\)/gi)].map((match) => match[1]);
  assert.deepEqual(selfReferences, []);
});

test('reusable design tokens have one UI-library source', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const styles = readFileSync(join(root, 'styles.css'), 'utf8');
  const theme = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'styles', 'theme.css'), 'utf8');
  const featureStyles = featureCss();
  const primitives = readFileSync(join(root, 'styles', 'primitives.css'), 'utf8');
  const tokens = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');
  // 产品基线必须先于 Tailwind 加载，避免无 layer 的 reset 覆盖
  // Tailwind utilities layer 生成的原子化边框宽度。
  assert.match(styles, /^@import '\.\/styles\/base\.css';\n@import '@peri\/ui\/styles\.css';\n@import '\.\/styles\/primitives\.css';/);
  assert.doesNotMatch(styles, /@import '\.\/styles\/tokens\.css'/);
  assert.doesNotMatch(primitives, /project-sidebar\.css/);
  assert.doesNotMatch(styles, /:root\s*\{/);
  assert.match(tokens, /:root\s*\{/);
  assert.match(tokens, /--composer-border:/);
  // theme.css 只是把 tokens 映射进 Tailwind 命名空间（@theme inline），
  // 每个变量声明必须直接引用 tokens 变量（var(...) 开头），不得声明字面值。
  // 例外：--breakpoint-* 断点 —— 媒体查询条件不能用 var()，必须字面量，
  // 且断点是框架概念而非设计值（tokens.css 不定义）。
  assert.match(theme, /@theme inline/);
  assert.doesNotMatch(theme, /--(?!breakpoint-)[a-z0-9-]+\s*:(?!\s*var\()/);
  assert.match(theme, /--breakpoint-desk:\s*960px/);
  assert.match(theme, /--breakpoint-wide:\s*1200px/);
  assert.doesNotMatch(tokens, /--breakpoint-/);
  assert.doesNotMatch(featureStyles, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  const declared = new Set([...tokens.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((match) => match[1]));
  const sourceFiles = [featureStyles, theme, ...listWidgetTsx().map((path) => readFileSync(path, 'utf8'))];
  const referenced = new Set(sourceFiles.flatMap((source) => [...source.matchAll(/var\(--([a-z0-9-]+)/gi)].map((match) => match[1])));
  assert.deepEqual([...referenced].filter((token) => !declared.has(token)), []);
});

// Tailwind 已全量采纳（2026-08-15 用户决策）：入口链经 @tailwindcss/vite 编译，
// theme.css 的 @theme inline 只做 tokens→utility 映射。此测试改为守护：
//   1) Tailwind 管线确实接线（manifest/vite/theme.css）；
//   2) 浏览器基线仍由非 layer 的 base.css 拥有（非 layer 规则在级联中优先于
//      Tailwind preflight 的 @layer base，这是 preflight 不覆盖产品基线的依据）；
//   3) 迁移期间组件仍使用语义类名（视觉不变的守护，迁移完成后重写为编译产物断言）。

test('product CSS owns its browser baseline and semantic layout', () => {
  const root = join(import.meta.dirname, '..');
  const source = join(root, 'src');
  const styles = featureCss();
  const base = readFileSync(join(source, 'styles', 'base.css'), 'utf8');
  const theme = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'styles', 'theme.css'), 'utf8');
  const manifest = readFileSync(join(root, 'package.json'), 'utf8');
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');

  assert.match(manifest, /"tailwindcss"/);
  assert.match(manifest, /"@tailwindcss\/vite"/);
  assert.match(vite, /tailwindcss\(\)/);
  assert.match(theme, /@import 'tailwindcss';/);
  assert.doesNotMatch(theme, /@theme[ \t]+(?!inline)/);
  assert.match(base, /\*[^]*盒模型[^]*\*\//);
  assert.match(base, /box-sizing:\s*border-box/);
  assert.match(base, /margin:\s*0/);
  assert.match(base, /padding:\s*0/);
  assert.match(base, /border:\s*0 solid/);
  assert.match(base, /\[hidden\]:where\(:not\(\[hidden=until-found\]\)\)\s*\{\s*display:\s*none\s*!important/);
  assert.match(base, /button,\s*input,\s*select,\s*optgroup,\s*textarea/);
  assert.match(base, /background-color:\s*transparent/);
  assert.match(base, /border-radius:\s*0/);
  assert.match(base, /h1,\s*h2,\s*h3,\s*h4,\s*h5,\s*h6/);
  assert.match(base, /code,\s*kbd,\s*samp,\s*pre\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
  assert.match(base, /ol,\s*ul,\s*menu\s*\{\s*list-style:\s*none/);
  assert.match(base, /img,\s*svg,\s*video,\s*canvas,\s*audio/);
  assert.match(base, /summary\s*\{\s*display:\s*list-item/);

  assert.doesNotMatch(styles, /\.message-list-shell>section>div/);
});

test('primitive visuals remain in the UI package', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const packageRoot = join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src');
  const primitives = readFileSync(join(packageRoot, 'styles', 'primitives.css'), 'utf8');
  const packageExtra = readFileSync(join(packageRoot, 'styles', 'extra.css'), 'utf8');
  const webPrimitives = readFileSync(join(root, 'styles', 'primitives.css'), 'utf8');
  const button = readFileSync(join(packageRoot, 'components', 'Button.tsx'), 'utf8');
  const dialog = readFileSync(join(packageRoot, 'components', 'Dialog.tsx'), 'utf8');
  const drawer = readFileSync(join(root, 'widgets', 'shell', 'shared', 'ProjectDrawer.tsx'), 'utf8');
  const chatLayout = readFileSync(join(packageRoot, 'components', 'chat', 'chat-layout.ts'), 'utf8');
  assert.match(chatLayout, /export const chatColumnClass/);
  assert.doesNotMatch(packageExtra, /\.ui-chat-/);
  assert.doesNotMatch(packageExtra, /\.chat-column\s*\{/);
  assert.doesNotMatch(packageExtra, /\.history-boundary\s*\{/);
  assert.doesNotMatch(packageExtra, /\.transcript-row\s*\{/);
  assert.doesNotMatch(webPrimitives, /\.chat-column\s*\{/);
  assert.match(primitives, /\.ui-scrollbar\s*\{/);
  assert.match(primitives, /\*::\-webkit-scrollbar\s*\{/);
  assert.match(primitives, /scrollbar-color:\s*var\(--scrollbar-thumb\) transparent/);
  assert.match(button, /export function Button/);
  assert.match(dialog, /export function DialogContent/);
  assert.match(drawer, /<Dialog open=\{props\.open\}/);
  assert.match(drawer, /<DialogContent/);
});

test('domain status inference delegates visual rendering to the shared Badge', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const adapter = readFileSync(join(root, 'features', 'shell', 'runtime-status-badge.ts'), 'utf8');
  const primitive = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Badge.tsx'), 'utf8');
  assert.match(adapter, /runtimeStatusBadgeTone/);
  assert.match(adapter, /topologyServerBadgeTone/);
  assert.doesNotMatch(adapter, /bg-\[|text-\[/);
  assert.match(primitive, /export type BadgeTone/);
  assert.match(primitive, /'ok'/);
  assert.match(primitive, /'warn'/);
  assert.match(primitive, /'err'/);
});

test('sidebar row accessories use static named group hover classes', () => {
  const source = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'RowAccessorySlot.tsx'), 'utf8');
  assert.match(source, /group-hover\/workspace:opacity-100/);
  assert.match(source, /group-hover\/row:opacity-100/);
  assert.match(source, /row-accessory-slot__actions/);
});

test('icon-only controls receive visible help from the shared Tooltip', () => {
  const root = join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components');
  const button = readFileSync(join(root, 'Button.tsx'), 'utf8');
  const tooltip = readFileSync(join(root, 'Tooltip.tsx'), 'utf8');
  assert.match(button, /<Tooltip placement=/);
  assert.match(button, /<TooltipTrigger/);
  assert.match(button, /<TooltipContent\b/);
  assert.doesNotMatch(button, /title=\{/);
  assert.match(tooltip, /@kobalte\/core\/tooltip/);
  assert.match(tooltip, /TooltipPrimitive\.Content/);
  const sessionAccessory = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'SidebarChrome.tsx'), 'utf8');
  assert.match(sessionAccessory, /<DropdownMenuTrigger[\s\S]*?as=\{IconButton\}[\s\S]*?session-menu/);
  assert.match(sessionAccessory, /ButtonGroup[\s\S]*?buttonGroupItemClass/);
  const buttonGroup = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'ButtonGroup.tsx'), 'utf8');
  assert.match(buttonGroup, /ui-button-group inline-flex/);
  assert.match(buttonGroup, /bg-transparent/);
  assert.doesNotMatch(buttonGroup, /bg-surface-overlay|shadow-sm/);
});

test('icon-only actions use one rounded rectangular geometry and never circular buttons', () => {
  const sourceRoot = join(import.meta.dirname, '..', 'src');
  const button = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Button.tsx'), 'utf8');
  const iconButtonBlock = button.slice(button.indexOf('const iconButtonVariants'));
  assert.match(iconButtonBlock, /rounded-6/);
  assert.match(iconButtonBlock, /sm: 'size-28'/);
  assert.match(iconButtonBlock, /md: 'size-36'/);
  assert.doesNotMatch(iconButtonBlock, /rounded-full/);
  for (const file of allFiles(sourceRoot).filter((path) => path.endsWith('.tsx'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<IconButton\b[\s\S]*?(?:\/>|<\/IconButton>)/g)) {
      assert.doesNotMatch(match[0], /rounded-full/, `${file} must not render a circular icon action`);
    }
  }
});

test('responsive navigation uses structural desktop layout and Kobalte modal behavior', () => {
  const shell = readWidgetTsx('AppShell.tsx');
  const drawer = readFileSync(join(sourceRoot(), 'widgets', 'shell', 'shared', 'ProjectDrawer.tsx'), 'utf8');
  assert.match(shell, /<ProjectDrawer\b/);
  assert.match(shell, /if \(!query\.matches\) setOpen\(false\)/);
  assert.doesNotMatch(shell, /document\.addEventListener\('keydown'/);
  assert.doesNotMatch(shell, /\.inert\s*=/);
  assert.match(drawer, /<aside/);
  assert.match(drawer, /<Dialog open=\{props\.open\}/);
  assert.match(drawer, /<DialogContent/);
  assert.match(drawer, /<DialogTitle class="sr-only">Projects &amp; Sessions<\/DialogTitle>/);
  assert.doesNotMatch(drawer, /acquireOverlay|document\.addEventListener/);
});
