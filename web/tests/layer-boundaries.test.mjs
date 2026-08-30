// 五层依赖边界（node:test）：替代 ESLint import 规则的门禁契约。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'src');

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, base) : [path.slice(base.length + 1)];
  });
}

function read(rel) {
  return readFileSync(join(root, rel), 'utf8');
}

function filesUnder(layerDir) {
  return walk(join(root, layerDir)).filter((path) => /\.(ts|tsx)$/.test(path) && !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'));
}

function importHits(code, pattern) {
  return [...code.matchAll(pattern)].map((match) => match[0]);
}

test('removed shim paths are not referenced from upper layers', () => {
  const offenders = [];
  const shimPatterns = [
    /from ['"]@?\/?components\/ui['"]/g,
    /from ['"].*\/panel\/components\//g,
    /from ['"]@\/lib\/cn['"]/g,
    /from ['"]\.\.\/lib\/cn['"]/g,
    /from ['"]\.\.\/\.\.\/lib\/cn['"]/g,
    /from ['"]\.\.\/\.\.\/\.\.\/lib\/cn['"]/g,
  ];
  for (const layer of ['widgets', 'pages', 'app', 'store']) {
    const dir = join(root, layer);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of walk(dir)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const code = read(`${layer}/${file}`);
      for (const pattern of shimPatterns) {
        const hits = importHits(code, pattern);
        if (hits.length > 0) offenders.push(`${layer}/${file}: ${hits.join(', ')}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('features do not import store or widgets', () => {
  const offenders = filesUnder('features').flatMap((file) => {
    const code = read(`features/${file}`);
    const hits = importHits(code, /from ['"]@?\/?.{0,2}(?:store|widgets)\//g);
    return hits.map((hit) => `features/${file}: ${hit}`);
  });
  assert.deepEqual(offenders, []);
});

test('shared layer does not import upper business layers', () => {
  const offenders = filesUnder('shared').flatMap((file) => {
    const code = read(`shared/${file}`);
    const hits = importHits(code, /from ['"]@?\/?.{0,2}(?:entities|features|widgets|pages|store|panel)\//g);
    return hits.map((hit) => `shared/${file}: ${hit}`);
  });
  assert.deepEqual(offenders, []);
});

test('entities do not import features, widgets, pages, or store', () => {
  const offenders = filesUnder('entities').flatMap((file) => {
    const code = read(`entities/${file}`);
    const hits = importHits(code, /from ['"]@?\/?.{0,2}(?:features|widgets|pages|store|panel)\//g);
    return hits.map((hit) => `entities/${file}: ${hit}`);
  });
  assert.deepEqual(offenders, []);
});
