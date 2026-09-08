import { describe, expect, it } from 'vitest';
import { vscodeFileIconKind, vscodeFolderIconKind } from './vscode-file-icons';

describe('VS Code file icon mapping', () => {
  it.each([
    ['src/test-keys.ts', 'typescript'],
    ['src/Composer.tsx', 'reactts'],
    ['src/client.js', 'javascript'],
    ['src/App.jsx', 'reactjs'],
    ['package.json', 'npm'],
    ['deno.lock', 'deno'],
    ['Cargo.toml', 'rust'],
    ['.env.local', 'dotenv'],
    ['scripts/deploy.sh', 'shell'],
    ['README.md', 'markdown'],
    ['public/logo.svg', 'svg'],
    ['unknown.extension', 'default-file'],
  ])('maps %s to %s', (path, kind) => {
    expect(vscodeFileIconKind(path)).toBe(kind);
  });

  it.each([
    ['src', false, 'folder-src'],
    ['src', true, 'folder-src-opened'],
    ['node_modules', false, 'folder-node'],
    ['docs', true, 'folder-docs-opened'],
    ['.git', false, 'folder-git'],
    ['custom', true, 'default-folder-opened'],
  ])('maps folder %s (open: %s) to %s', (path, open, kind) => {
    expect(vscodeFolderIconKind(path, open)).toBe(kind);
  });
});
