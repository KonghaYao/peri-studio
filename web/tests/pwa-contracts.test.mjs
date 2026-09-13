// PWA 源码契约：仅生产 index.html 带 manifest；禁止 Service Worker 注册。

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const webRoot = join(import.meta.dirname, '..');

const allFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
  const path = join(directory, item.name);
  return item.isDirectory() ? allFiles(path) : [path];
});

test('production index.html is the only PWA install entry', () => {
  const index = readFileSync(join(webRoot, 'index.html'), 'utf8');
  assert.match(index, /<title>Peri Studio<\/title>/);
  assert.match(index, /viewport-fit=cover/);
  assert.match(index, /name="theme-color"\s+content="#ffffff"/);
  assert.match(index, /rel="manifest"\s+href="\/manifest\.webmanifest"/);
  assert.match(index, /rel="apple-touch-icon"/);
  assert.match(index, /href="\/favicon\.svg"/);
  assert.match(index, /name="apple-mobile-web-app-capable"/);
  assert.match(index, /name="apple-mobile-web-app-status-bar-style"\s+content="default"/);

  const sandbox = readFileSync(join(webRoot, 'sandbox.html'), 'utf8');
  const fixture = readFileSync(join(webRoot, 'visual-fixture.html'), 'utf8');
  for (const source of [sandbox, fixture]) {
    assert.doesNotMatch(source, /rel=["']manifest["']/);
    assert.doesNotMatch(source, /serviceWorker/);
    assert.doesNotMatch(source, /apple-mobile-web-app-capable/);
  }

  const distSandbox = join(webRoot, 'dist', 'sandbox.html');
  if (existsSync(distSandbox)) {
    const embedded = readFileSync(distSandbox, 'utf8');
    assert.doesNotMatch(embedded, /rel=["']manifest["']/);
    assert.doesNotMatch(embedded, /serviceWorker/);
  }
});

test('web source never registers a service worker', () => {
  const srcRoot = join(webRoot, 'src');
  const offenders = allFiles(srcRoot)
    .filter((path) => /\.(?:ts|tsx|js|mjs|html)$/.test(path))
    .filter((path) => /navigator\.serviceWorker\.register|vite-plugin-pwa|workbox/i.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(webRoot.length + 1));
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(readFileSync(join(webRoot, 'index.html'), 'utf8'), /serviceWorker/);
});
