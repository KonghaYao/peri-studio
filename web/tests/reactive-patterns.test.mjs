import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..', 'src');
const widgetsRoot = join(root, 'widgets');

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (entry.endsWith('.tsx')) acc.push(path);
  }
  return acc;
}

test('widgets forbid top-level props destructuring', () => {
  const files = walk(widgetsRoot);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /const\s*\{\s*\w+\s*\}\s*=\s*props\b/,
      `${file} must not destructure props`,
    );
  }
});

test('widgets use shared maybe-accessor instead of local duplicates', () => {
  const offenders = walk(widgetsRoot).filter((file) => {
    const source = readFileSync(file, 'utf8');
    return /type MaybeAccessor</.test(source) || /function read</.test(source);
  });
  assert.deepEqual(offenders, [], `duplicate MaybeAccessor helpers: ${offenders.join(', ')}`);
});

test('session row keeps server-authoritative open without eager navigate', () => {
  const sessionRow = readFileSync(join(widgetsRoot, 'sidebar', 'ProjectSessionRow.tsx'), 'utf8');
  assert.match(sessionRow, /props\.onOpen\(session\(\)\.id, props\.onNavigate\)/);
  assert.match(sessionRow, /selected\(\) && 'font-medium'/);
});

test('git change tree subscribes mutation busy inside row component', () => {
  const tree = readFileSync(join(widgetsRoot, 'resource', 'git', 'GitChangeTree.tsx'), 'utf8');
  assert.match(tree, /function ChangeRowActions/);
  assert.match(tree, /resourceWorkspace\(\)\.mutations/);
});

test('cross-widget accessor handoffs avoid snapshot session prop', () => {
  const row = readFileSync(join(widgetsRoot, 'sidebar', 'project-sidebar-row.tsx'), 'utf8');
  assert.match(row, /session=\{session\}/);
  assert.doesNotMatch(row, /session=\{session\(\)\}/);
});
