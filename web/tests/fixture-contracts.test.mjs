// visual fixture 契约（node:test）：fixture 入口隔离（dev-only、不绕过生产鉴权）
// 与 overlay 几何断言。按主题从原 state-contracts 拆分而来，断言意图与原文件一致。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('visual fixture isolation and overlay geometry remain part of the default gate', () => {
  const root = join(import.meta.dirname, '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const fixtureCss = readFileSync(join(root, 'src', 'visual-fixture', 'fixture.css'), 'utf8');
  assert.match(pkg.scripts.test, /verify-production-boundary\.mjs/);
  assert.match(fixtureCss, /\.visual-fixture-rail\s*\{[^}]*z-index:40/s);
  assert.match(fixtureCss, /\.visual-scenario-sidebar\s*\{[^}]*width:242px/s);
  assert.match(fixtureCss, /@media\(max-width:640px\)[\s\S]*\.visual-fixture-root~\.ui-toast-viewport\{top:54px\}/);
  assert.match(readFileSync(join(root, 'src', 'visual-fixture', 'main.tsx'), 'utf8'), /authenticated-app visual-fixture-root/);
});

test('the visual fixture is a development-only entry and cannot bypass production auth', () => {
  const root = join(import.meta.dirname, '..');
  const index = readFileSync(join(root, 'index.html'), 'utf8');
  const fixture = readFileSync(join(root, 'visual-fixture.html'), 'utf8');
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  const productionMain = readFileSync(join(root, 'src', 'app', 'main.tsx'), 'utf8');
  const authGate = readFileSync(join(root, 'src', 'widgets', 'auth', 'AuthGate.tsx'), 'utf8');
  const fixtureMain = readFileSync(join(root, 'src', 'visual-fixture', 'main.tsx'), 'utf8');
  const scenarios = readFileSync(join(root, 'src', 'visual-fixture', 'scenarios.ts'), 'utf8');

  assert.match(index, /src="\/src\/app\/main\.tsx"/);
  assert.doesNotMatch(index, /visual-fixture/);
  assert.match(fixture, /src="\/src\/visual-fixture\/main\.tsx"/);
  assert.doesNotMatch(fixture, /panel\/main|AuthGate/);
  assert.match(vite, /input:\s*\{[^}]*index:\s*resolve\(rootDir, 'index\.html'\)/s);
  assert.doesNotMatch(vite, /visual-fixture/);
  for (const source of [productionMain, authGate]) {
    assert.doesNotMatch(source, /visual-fixture|fixtureScenario|VITE_.*FIXTURE|scenario=.*auth/i);
  }
  assert.doesNotMatch(fixtureMain, /AuthGate|connectWithCookie|api\/auth\/session|(?:auth|access|refresh)[_-]?token|token(?:file|value|credential)/i);
  assert.match(fixtureMain, /installVisualScenario/);
  for (const id of ['catalog', 'conversation', 'markdown', 'permission-streaming', 'terminal-readonly']) {
    assert.match(scenarios, new RegExp(`['"]${id}['"]`));
  }
  assert.match(scenarios, /DEFAULT_VISUAL_SCENARIO\s*=\s*['"]conversation['"]/);
  assert.doesNotMatch(scenarios, /action:\s*['"]reconnect['"]/);
  const visualContract = readFileSync(join(root, 'scripts', 'visual-contract.mjs'), 'utf8');
  assert.match(visualContract, /export const assertVisualContract/);
  assert.match(visualContract, /navigator\.language/);
  assert.match(visualContract, /resolvedOptions\(\)\.timeZone/);
  assert.match(visualContract, /messageListViewportHeight/);
  assert.match(visualContract, /messageTotal/);
});

test('component geometry tokens are declared once and consumed by production widgets', () => {
  const webRoot = join(import.meta.dirname, '..', 'src');
  const read = (...parts) => readFileSync(join(webRoot, ...parts), 'utf8');
  const tokens = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');
  const composer = [
    read('widgets', 'composer', 'Composer.tsx'),
    read('widgets', 'composer', 'ComposerStagedAssets.tsx'),
    read('widgets', 'composer', 'ComposerToolbar.tsx'),
  ].join('\n');
  const tool = read('widgets', 'chat', 'ToolCallCard.tsx');
  const toolActivity = read('widgets', 'chat', 'ToolCallCard.tsx');
  const mcpApp = read('widgets', 'chat', 'McpAppFrame.tsx');
  const status = read('widgets', 'shell', 'StatusArea.tsx');
  const questions = read('widgets', 'chat', 'ElicitationQueue.tsx');
  const permissions = read('widgets', 'chat', 'PermissionQueue.tsx');
  const permissionCard = read('widgets', 'chat', 'PermissionRequestCard.tsx');
  const decisionCard = readFileSync(
    join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'QuestionnaireFrame.tsx'),
    'utf8',
  );
  const explorer = read('widgets', 'resource', 'ExplorerPanel.tsx');
  const sourceControl = read('widgets', 'resource', 'SourceControlPanel.tsx');
  const button = readFileSync(join(import.meta.dirname, '..', '..', 'packages', 'ui', 'src', 'components', 'Button.tsx'), 'utf8');

  const webUi = `${composer}\n${tool}\n${toolActivity}\n${mcpApp}\n${status}\n${questions}\n${permissions}\n${permissionCard}\n${decisionCard}\n${explorer}\n${sourceControl}\n${button}`;
  for (const token of [
    'control-height-compact', 'pattern-row-height', 'tree-row-height',
    'status-panel-max-height', 'composer-radius',
    'decision-radius', 'permission-card-min-height', 'tool-activity-max',
  ]) {
    assert.match(tokens, new RegExp(`--${token}:`));
    assert.match(webUi, new RegExp(`--${token}`));
  }
  assert.match(tokens, /--asset-tile-size:/);
  assert.match(tokens, /--composer-upload-tile-width:/);
  assert.doesNotMatch(composer, /token-composer|design-token/);
  assert.doesNotMatch(tool, /token-tool|design-token/);
});
