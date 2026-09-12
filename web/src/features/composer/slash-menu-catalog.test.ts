import { describe, expect, it } from 'vitest';
import { agentCommandToSlashMenuItem } from './slash-menu-catalog';

describe('agentCommandToSlashMenuItem', () => {
  it('marks skills as accent rows', () => {
    const skill = { name: 'review', description: 'Review', kind: 'skill' as const };
    expect(agentCommandToSlashMenuItem(skill)).toMatchObject({
      name: 'review',
      description: 'Review',
      kind: 'skill',
      accent: true,
      dividerAfter: false,
    });
  });

  it('inserts a divider when a command group is followed by skills', () => {
    const command = { name: 'compact', description: 'Compress', kind: 'command' as const };
    const skill = { name: 'review', description: 'Review', kind: 'skill' as const };
    expect(agentCommandToSlashMenuItem(command, skill)).toMatchObject({
      name: 'compact',
      dividerAfter: true,
    });
  });
});
