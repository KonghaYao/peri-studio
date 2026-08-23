// CSS 与 UI 视觉系统契约（node:test）：CSS 结构/token/媒体查询断言，
// 以及特性组件对 UI 库的消费边界（barrel 出口、SVG 画布、按钮行为、色彩、
// Badge/Tooltip/Drawer 视觉委托）。按主题从原 state-contracts 拆分而来，
// 断言意图与原文件一致。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { transform } from 'lightningcss';
import postcss from 'postcss';

// styles.css is the cascade entry now: it imports ui/base.css, ui/primitives.css
// and the feature sheets under panel/styles/. Feature assertions run against the
// concatenated source so the cascade contract stays covered per selector.
const cssFiles = () => {
  const source = join(import.meta.dirname, '..', 'src');
  const entry = readFileSync(join(source, 'styles.css'), 'utf8');
  return [...entry.matchAll(/@import\s+'([^']+)';/g)].map((match) => match[1].replace(/^\.\//, ''));
};
const featureCss = () => cssFiles().map((file) => readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8')).join('\n');

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
  const theme = readFileSync(join(source, 'styles', 'theme.css'), 'utf8');
  const declared = new Set([...theme.matchAll(/--spacing-(\d+)\s*:/g)].map((match) => match[1]));
  assert.deepEqual([...used].filter((token) => token !== '0' && !declared.has(token)).sort((left, right) => Number(left) - Number(right)), []);
});

test('source stylesheets are structurally valid and consume only declared design tokens', () => {
  const source = join(import.meta.dirname, '..', 'src');
  const files = ['styles.css', 'styles/base.css', 'styles/primitives.css', 'styles/tokens.css', ...cssFiles().filter((file) => file.startsWith('panel/styles/'))];
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
  const tokenSource = readFileSync(join(source, 'styles', 'tokens.css'), 'utf8');
  const defined = new Set([...tokenSource.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  const used = new Set(stylesheets.flatMap((file) => [...readFileSync(join(source, file), 'utf8').matchAll(/var\((--[\w-]+)/g)].map((match) => match[1])));
  assert.deepEqual([...used].filter((token) => !defined.has(token)).sort(), []);
});

test('Kobalte dialog composes an independently layered portal overlay and content', () => {
  const dialog = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'Dialog.tsx'), 'utf8');
  assert.match(dialog, /return <DialogPrimitive\.Portal \{\.\.\.props\} \/>;/);
  assert.match(dialog, /<DialogOverlay \/>\s*<DialogPrimitive\.Content/s);
  assert.match(dialog, /DialogPrimitive\.Overlay data-dialog-overlay class=\{cn\('fixed inset-0 z-60 bg-scrim'/);
  assert.match(dialog, /DialogPrimitive\.Content\s+class=\{cn\('fixed top-1\/2 left-1\/2 z-61/);
  assert.match(dialog, /onEscapeKeyDown=\{preventWhenLocked\}/);
  assert.match(dialog, /onPointerDownOutside=\{preventWhenLocked\}/);
});

test('dialog size belongs to DialogContent rather than an overflowing child', () => {
  const source = join(import.meta.dirname, '..', 'src');
  const dialog = readFileSync(join(source, 'components', 'ui', 'Dialog.tsx'), 'utf8');
  const components = join(source, 'panel', 'components');
  const dialogConsumers = readdirSync(components)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => [file, readFileSync(join(components, file), 'utf8')])
    .filter(([, code]) => code.includes('<DialogContent'));
  assert.match(dialog, /type DialogSize = 'default' \| 'search' \| 'settings' \| 'mcp' \| 'rewind'/);
  for (const [file, code] of dialogConsumers) {
    assert.doesNotMatch(code, /<DialogContent[\s\S]{0,300}(?:w-|min-w-)\(--container-/, `${file} puts viewport width inside DialogContent`);
  }
});

test('Composer and quick start expose one labeled textarea and keyboard submit guidance', () => {
  const root = join(import.meta.dirname, '..', 'src', 'panel', 'components');
  const composer = readFileSync(join(root, 'Composer.tsx'), 'utf8');
  const quickStart = readFileSync(join(root, 'QuickStartComposer.tsx'), 'utf8');
  assert.match(composer, /<Textarea[\s\S]*?aria-label="Message the agent"/);
  assert.match(composer, /aria-autocomplete="list"/);
  assert.match(composer, /if \(e\.key === 'Enter' && !e\.shiftKey\) \{\s*e\.preventDefault\(\);\s*submit\(\);/);
  assert.match(quickStart, /<Textarea[\s\S]*?aria-label="First message"/);
  assert.match(quickStart, /variant="bare"/);
  assert.match(quickStart, /if \(event\.key === 'Enter' && !event\.shiftKey\) \{ event\.preventDefault\(\); submit\(\); \}/);
});

test('feature components consume the Solid UI library only through its public barrel', () => {
  const components = join(import.meta.dirname, '..', 'src', 'panel', 'components');
  const offenders = readdirSync(components)
    .filter((file) => file.endsWith('.tsx'))
    .filter((file) => /from\s+['"]\.\.\/\.\.\/ui\//.test(readFileSync(join(components, file), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('feature-owned SVG geometry always uses the shared finite icon canvas', () => {
  const components = join(import.meta.dirname, '..', 'src', 'panel', 'components');
  const offenders = readdirSync(components)
    .filter((file) => file.endsWith('.tsx'))
    .filter((file) => /<svg\b/.test(readFileSync(join(components, file), 'utf8')));
  assert.deepEqual(offenders, []);
  const icon = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'Icon.tsx'), 'utf8');
  assert.match(icon, /<svg/);
  assert.match(icon, /viewBox="0 0 20 20"/);
  assert.match(icon, /aria-hidden="true"/);
  assert.match(icon, /fill="none"/);
  assert.match(icon, /stroke="currentColor"/);
});

test('high-frequency chat controls are owned by the Solid UI library', () => {
  const components = join(import.meta.dirname, '..', 'src', 'panel', 'components');
  for (const file of ['Composer.tsx', 'MessageList.tsx']) {
    assert.doesNotMatch(readFileSync(join(components, file), 'utf8'), /<button\b/, file);
  }
});

test('MessageList delegates entry semantics through stable entry-id slots to one tested conversation component', () => {
  const components = join(import.meta.dirname, '..', 'src', 'panel', 'components');
  const list = readFileSync(join(components, 'MessageList.tsx'), 'utf8');
  const message = readFileSync(join(components, 'ConversationMessage.tsx'), 'utf8');
  assert.match(list, /const chatEntryIds = createMemo\(\(\) => chatEntries\(\)\.map\(\(entry\) => entry\.id\)\)/);
  assert.match(list, /<ConversationMessage entry=\{\(\) => chatEntriesById\(\)\.get\(id\)!\} \/>/);
  assert.doesNotMatch(list, /function MessageBubble|<Markdown|<ToolCallCard/);
  assert.match(message, /conversation-message--\$\{role\(\)\}/);
  assert.match(message, /role="alert" aria-label="Message error"/);
});

test('the permission surface exposes a queue and never resolves an empty identity', () => {
  const components = join(import.meta.dirname, '..', 'src', 'panel', 'components');
  const messageList = readFileSync(join(components, 'MessageList.tsx'), 'utf8');
  const queue = readFileSync(join(components, 'PermissionQueue.tsx'), 'utf8');
  const card = readFileSync(join(components, 'PermissionRequestCard.tsx'), 'utf8');
  assert.match(messageList, /<PermissionQueue/);
  assert.doesNotMatch(messageList, /permissions\(\)\[0\]/);
  assert.match(queue, /if \(id\) props\.onResolve\(id, decision\)/);
  assert.match(card, /disabled=\{props\.readOnly \|\| locked\(\) \|\| !actionable\(\)\}/);
});

test('the shared Button defaults to non-submitting behavior', () => {
  const button = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'Button.tsx'), 'utf8');
  assert.match(button, /type=\{button\.type \?\? 'button'\}/);
});

test('feature-owned native buttons always state their form behavior', () => {
  const components = join(import.meta.dirname, '..', 'src', 'panel', 'components');
  const offenders = readdirSync(components)
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
    .flatMap((file) => [...readFileSync(join(components, file), 'utf8').matchAll(/<button\b([^>]*)>/gs)]
      .filter((match) => !/\btype\s*=/.test(match[1]))
      .map(() => file));
  assert.deepEqual(offenders, []);
});

test('feature components never introduce literal colors', () => {
  const components = join(import.meta.dirname, '..', 'src', 'panel', 'components');
  const offenders = readdirSync(components)
    .filter((file) => file.endsWith('.tsx'))
    .filter((file) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(readFileSync(join(components, file), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('large semantic status surfaces stay white', () => {
  const source = join(import.meta.dirname, '..', 'src');
  const files = [
    'components/ui/InlineNotice.tsx',
    'panel/components/MessageOutbox.tsx',
    'panel/components/PermissionQueue.tsx',
    'panel/components/PermissionRequestCard.tsx',
    'panel/components/RewindDialog.tsx',
    'panel/components/ToolCallCard.tsx',
    'panel/components/shared/ConfirmDialog.tsx',
  ];
  for (const file of files) {
    const code = readFileSync(join(source, file), 'utf8');
    assert.doesNotMatch(code, /bg-(?:warning|danger|success)-soft/, `${file} uses a tinted status canvas`);
  }
});

test('responsive behavior has compact, medium and wide layout contracts', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const shell = readFileSync(join(root, 'panel', 'components', 'AppShell.tsx'), 'utf8');
  const drawer = readFileSync(join(root, 'panel', 'components', 'shared', 'ProjectDrawer.tsx'), 'utf8');
  const messageList = readFileSync(join(root, 'panel', 'components', 'MessageList.tsx'), 'utf8');
  const composer = readFileSync(join(root, 'panel', 'components', 'Composer.tsx'), 'utf8');
  const theme = readFileSync(join(root, 'styles', 'theme.css'), 'utf8');
  const breakpoints = readFileSync(join(root, 'panel', 'lib', 'breakpoints.ts'), 'utf8');
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
  assert.match(drawer, /<aside[^>]*class=\{drawerClass\}/);
  assert.match(drawer, /<Dialog open=\{props\.open\}/);
  assert.match(drawer, /max-desk:fixed[^']*max-desk:w-\(--container-drawer\)/);
  // 中宽布局的内容宽度：chat 列表 760px、composer 使用同一布局 token。
  assert.match(messageList, /desk:max-wide:max-w-\(--container-chat-narrow\)/);
  assert.match(composer, /max-w-\(--container-chat\)/);
  assert.match(composer, /desk:max-wide:max-w-\(--container-chat-narrow\)/);
  assert.match(composer, /max-narrow:px-10/);
  assert.doesNotMatch(drawer, /project-drawer\s*\{[^}]*position\s*:\s*fixed/);
});

test('coarse pointers expose sidebar actions without hover and keep controls touch-sized', () => {
  const sessionRow = readFileSync(join(import.meta.dirname, '..', 'src', 'panel', 'components', 'ProjectSessionRow.tsx'), 'utf8');
  const dialog = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'Dialog.tsx'), 'utf8');
  assert.match(sessionRow, /group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:size-44 pointer-coarse:min-h-44 pointer-coarse:opacity-100/);
  assert.match(sessionRow, /pointer-coarse:min-h-52 pointer-coarse:pr-\[68px\]/);
  assert.match(dialog, /pointer-coarse:size-44/);
});

test('P0 interaction architecture cannot regress to hidden cancel or viewport-breaking overlays', () => {
  const componentRoot = join(import.meta.dirname, '..', 'src', 'panel', 'components');
  const composer = readFileSync(join(componentRoot, 'Composer.tsx'), 'utf8');
  const sidebarChrome = readFileSync(join(componentRoot, 'SidebarChrome.tsx'), 'utf8');
  const dialog = readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'Dialog.tsx'), 'utf8');
  const styles = featureCss();
  assert.match(composer, /cancelTurn/);
  assert.match(composer, /Stop generation/);
  assert.match(composer, /control\?\.phase === 'uncertain'[\s\S]*?retryPersistentAction\(control\.commandId\)/);
  assert.match(composer, /Confirm stop with original request/);
  assert.match(dialog, /DialogPrimitive\.Portal/);
  assert.match(sidebarChrome, /sidebar-footer/);
  assert.doesNotMatch(styles, /logout-button[^}]*position\s*:\s*fixed/s);
});

test('composer keeps the writing surface quiet and keyboard behavior discoverable', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const composer = readFileSync(join(root, 'panel', 'components', 'Composer.tsx'), 'utf8');
  const base = readFileSync(join(root, 'styles', 'base.css'), 'utf8');
  assert.match(composer, /Enter to send · Shift \+ Enter for newline/);
  assert.match(composer, /runtimeSummary/);
  assert.doesNotMatch(composer, />\s*effort：/);
  assert.doesNotMatch(composer, />\s*上下文：/);
  assert.doesNotMatch(composer, /focus-within:border-focus-ring/);
  assert.doesNotMatch(composer, /has-\[\.composer-input:focus-visible\]:shadow-/);
  assert.match(composer, /composer-toolbar flex min-h-44 items-center/);
  assert.match(base, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\)/);
});

test('design tokens cannot directly reference themselves', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'src', 'styles', 'tokens.css'), 'utf8');
  const selfReferences = [...css.matchAll(/--([a-z0-9-]+)\s*:\s*var\(--\1\)/gi)].map((match) => match[1]);
  assert.deepEqual(selfReferences, []);
});

test('reusable design tokens have one UI-library source', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const styles = readFileSync(join(root, 'styles.css'), 'utf8');
  const theme = readFileSync(join(root, 'styles', 'theme.css'), 'utf8');
  const featureStyles = featureCss();
  const primitives = readFileSync(join(root, 'styles', 'primitives.css'), 'utf8');
  const tokens = readFileSync(join(root, 'styles', 'tokens.css'), 'utf8');
  // 产品基线必须先于 Tailwind 加载，避免无 layer 的 reset 覆盖
  // Tailwind utilities layer 生成的原子化边框宽度。
  assert.match(styles, /^@import '\.\/styles\/base\.css';\n@import '\.\/styles\/theme\.css';\n@import '\.\/styles\/primitives\.css';/);
  assert.doesNotMatch(styles, /@import '\.\/styles\/tokens\.css'/);
  assert.match(primitives, /^@import '\.\/tokens\.css';/);
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
  const sourceFiles = [featureStyles, theme, ...readdirSync(join(root, 'panel', 'components'))
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => readFileSync(join(root, 'panel', 'components', file), 'utf8'))];
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
  const theme = readFileSync(join(source, 'styles', 'theme.css'), 'utf8');
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

test('primitive visuals remain in shared UI components and out of feature styles', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const styles = cssFiles().filter((file) => file.startsWith('panel/styles/'))
    .map((file) => readFileSync(join(root, file), 'utf8')).join('\n');
  const primitives = readFileSync(join(root, 'styles', 'primitives.css'), 'utf8');
  const button = readFileSync(join(root, 'components', 'ui', 'Button.tsx'), 'utf8');
  const dialog = readFileSync(join(root, 'components', 'ui', 'Dialog.tsx'), 'utf8');
  const drawer = readFileSync(join(root, 'panel', 'components', 'shared', 'ProjectDrawer.tsx'), 'utf8');
  assert.match(primitives, /\.ui-scrollbar\s*\{/);
  assert.match(primitives, /\*::\-webkit-scrollbar\s*\{/);
  assert.match(primitives, /scrollbar-color:\s*var\(--scrollbar-thumb\) transparent/);
  assert.match(button, /export function Button/);
  assert.match(dialog, /export function DialogContent/);
  assert.equal(styles.trim(), '');
  assert.match(drawer, /<Dialog open=\{props\.open\}/);
  assert.match(drawer, /<DialogContent/);
});

test('domain status inference delegates visual rendering to the shared Badge', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const adapter = readFileSync(join(root, 'panel', 'components', 'Badge.tsx'), 'utf8');
  const primitive = readFileSync(join(root, 'components', 'ui', 'Badge.tsx'), 'utf8');
  assert.match(adapter, /Badge as UiBadge/);
  assert.doesNotMatch(adapter, /bg-\[|text-\[/);
  assert.match(primitive, /BadgeTone = 'neutral' \| 'ok' \| 'warn' \| 'err'/);
});

test('icon-only controls receive visible help from the shared Tooltip', () => {
  const root = join(import.meta.dirname, '..', 'src', 'components', 'ui');
  const button = readFileSync(join(root, 'Button.tsx'), 'utf8');
  const tooltip = readFileSync(join(root, 'Tooltip.tsx'), 'utf8');
  assert.match(button, /<Tooltip placement=/);
  assert.match(button, /<TooltipTrigger/);
  assert.match(button, /<TooltipContent\b/);
  assert.doesNotMatch(button, /title=\{/);
  assert.match(tooltip, /@kobalte\/core\/tooltip/);
  assert.match(tooltip, /TooltipPrimitive\.Content/);
  const sessionRow = readFileSync(join(import.meta.dirname, '..', 'src', 'panel', 'components', 'ProjectSessionRow.tsx'), 'utf8');
  assert.match(sessionRow, /<DropdownMenuTrigger as=\{IconButton\}[\s\S]*?class="session-menu(?:\s|[^"]*?")/);
  assert.doesNotMatch(sessionRow, /<button[^>]*class="session-menu"/);
});

test('responsive navigation uses structural desktop layout and Kobalte modal behavior', () => {
  const root = join(import.meta.dirname, '..', 'src');
  const shell = readFileSync(join(root, 'panel', 'components', 'AppShell.tsx'), 'utf8');
  const drawer = readFileSync(join(root, 'panel', 'components', 'shared', 'ProjectDrawer.tsx'), 'utf8');
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
