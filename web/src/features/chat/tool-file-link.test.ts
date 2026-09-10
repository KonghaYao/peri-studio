import { describe, expect, it } from 'vitest';
import {
  compactToolInput,
  extractLinkableFilePath,
  formatWorkspacePathLabel,
  normalizeWorkspaceRelativePath,
} from './tool-file-link';

describe('tool-file-link', () => {
  it('normalizes absolute paths under project cwd', () => {
    expect(normalizeWorkspaceRelativePath('/workspace/src/main.rs', '/workspace')).toBe('src/main.rs');
    expect(normalizeWorkspaceRelativePath('web/foo.ts', '/workspace')).toBe('web/foo.ts');
  });

  it('formats workspace paths without hiding location context', () => {
    expect(formatWorkspacePathLabel('/workspace/project/web/src/main.ts', '/workspace/project')).toBe('web/src/main.ts');
    expect(formatWorkspacePathLabel('/workspace/other/main.ts', '/workspace/project')).toBe('/workspace/other/main.ts');
    expect(formatWorkspacePathLabel('web/src/main.ts', '/workspace/project')).toBe('web/src/main.ts');
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

  describe('G2 characterization — linkable path vs search tools (today behavior)', () => {
    it('does not treat Grep/Glob pattern-only args as linkable file paths', () => {
      expect(extractLinkableFilePath('Grep', 'execute', { pattern: '*.ts' })).toBeNull();
      expect(extractLinkableFilePath('Glob', 'execute', { pattern: '**/*.rs' })).toBeNull();
      expect(compactToolInput({ pattern: '*.ts' })).toBe('*.ts');
      expect(extractLinkableFilePath('Grep', 'execute', { pattern: '*.ts' })).toBeNull();
    });

    it('locks Grep with explicit file_path as linkable (legacy name rule)', () => {
      expect(
        extractLinkableFilePath('Grep', 'execute', { pattern: '*.ts', file_path: '/workspace/a.ts' }),
      ).toBe('/workspace/a.ts');
    });

    it('links filesystem tools by kind or normalized tool name', () => {
      expect(extractLinkableFilePath('Write', 'edit', { file_path: 'src/x.ts' })).toBe('src/x.ts');
      expect(extractLinkableFilePath('custom_read', 'read', { path: 'b.rs' })).toBe('b.rs');
      expect(extractLinkableFilePath('Glob', 'execute', { file_path: 'only/with/path.ts' })).toBeNull();
    });
  });
});
