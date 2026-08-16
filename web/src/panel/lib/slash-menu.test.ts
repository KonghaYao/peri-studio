import { describe, expect, it } from 'vitest';
import { filterCommandCatalog, insertSlashCommand, slashTokenAt } from './slash-menu';

const catalog = [
  { name: 'compact', description: 'Compress context', kind: 'command' as const },
  { name: 'auto-issue-fixer', description: 'Fix an engineering issue', kind: 'skill' as const },
  { name: 'mcp__docs__search', description: 'Search docs', kind: 'mcp_skill' as const },
];

describe('slash menu model', () => {
  it('detects a caret-local slash token without mistaking paths for commands', () => {
    expect(slashTokenAt('please /auto', 12)).toEqual({ start: 7, end: 12, query: 'auto' });
    expect(slashTokenAt('open /tmp/file', 14)).toBeNull();
    expect(slashTokenAt('plain text', 10)).toBeNull();
  });

  it('ranks exact and prefix matches while keeping the Skills browse mode typed', () => {
    expect(filterCommandCatalog(catalog, 'auto', 'all').map((item) => item.name))
      .toEqual(['auto-issue-fixer']);
    expect(filterCommandCatalog(catalog, '', 'skills').map((item) => item.name))
      .toEqual(['auto-issue-fixer', 'mcp__docs__search']);
  });

  it('replaces an active token or inserts at the caret without sending', () => {
    expect(insertSlashCommand('/aut', 4, 'auto-issue-fixer'))
      .toEqual({ text: '/auto-issue-fixer ', cursor: 18 });
    expect(insertSlashCommand('please inspect', 6, 'auto-issue-fixer'))
      .toEqual({ text: 'please /auto-issue-fixer inspect', cursor: 25 });
  });
});
