import { describe, expect, it } from 'vitest';
import { compactToolInput, extractLinkableFilePath, normalizeWorkspaceRelativePath } from './tool-file-link';

describe('tool-file-link', () => {
  it('normalizes absolute paths under project cwd', () => {
    expect(normalizeWorkspaceRelativePath('/workspace/src/main.rs', '/workspace')).toBe('src/main.rs');
    expect(normalizeWorkspaceRelativePath('web/foo.ts', '/workspace')).toBe('web/foo.ts');
  });

  it('extracts file paths for read/edit tools', () => {
    expect(extractLinkableFilePath('Read', 'read', { file_path: '/workspace/a.ts' })).toBe('/workspace/a.ts');
    expect(extractLinkableFilePath('Edit', 'edit', { file_path: 'b.ts' })).toBe('b.ts');
    expect(extractLinkableFilePath('Bash', 'execute', { command: 'ls' })).toBeNull();
  });

  it('prefers file path in compact input', () => {
    expect(compactToolInput({ file_path: '/x', limit: 10 })).toBe('/x');
    expect(compactToolInput({ pattern: '*.ts' })).toBe('*.ts');
  });
});
