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
  assert.match(fixtureCss, /\.visual-fixture-rail\s*\{[^}]*z-index:20/s);
  assert.match(fixtureCss, /@media\(max-width:640px\)[\s\S]*\.visual-fixture-root~\.ui-toast-viewport\{top:54px\}/);
  assert.match(readFileSync(join(root, 'src', 'visual-fixture', 'main.tsx'), 'utf8'), /authenticated-app visual-fixture-root/);
});

test('the visual fixture is a development-only entry and cannot bypass production auth', () => {
  const root = join(import.meta.dirname, '..');
  const index = readFileSync(join(root, 'index.html'), 'utf8');
  const fixture = readFileSync(join(root, 'visual-fixture.html'), 'utf8');
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  const productionMain = readFileSync(join(root, 'src', 'panel', 'main.tsx'), 'utf8');
  const authGate = readFileSync(join(root, 'src', 'panel', 'components', 'AuthGate.tsx'), 'utf8');
  const fixtureMain = readFileSync(join(root, 'src', 'visual-fixture', 'main.tsx'), 'utf8');
  const scenarios = readFileSync(join(root, 'src', 'visual-fixture', 'scenarios.ts'), 'utf8');

  assert.match(index, /src="\/src\/panel\/main\.tsx"/);
  assert.doesNotMatch(index, /visual-fixture/);
  assert.match(fixture, /src="\/src\/visual-fixture\/main\.tsx"/);
  assert.doesNotMatch(fixture, /panel\/main|AuthGate/);
  assert.match(vite, /input:\s*\{[^}]*index:\s*resolve\(rootDir, 'index\.html'\)/s);
  assert.doesNotMatch(vite, /visual-fixture/);
  for (const source of [productionMain, authGate]) {
    assert.doesNotMatch(source, /visual-fixture|fixtureScenario|VITE_.*FIXTURE|scenario=.*auth/i);
  }
  assert.doesNotMatch(fixtureMain, /AuthGate|connectWithCookie|api\/auth\/session|token/i);
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
  assert.match(visualContract, /connectionStatus/);
});
