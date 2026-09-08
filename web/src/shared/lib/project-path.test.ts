import { describe, expect, it } from 'vitest';
import { projectNameFromPath } from './project-path';

describe('projectNameFromPath', () => {
  it('uses the final path segment as the project name', () => {
    expect(projectNameFromPath('/Users/dev/code/peri-studio')).toBe('peri-studio');
    expect(projectNameFromPath('/Users/dev/code/peri-studio/')).toBe('peri-studio');
  });

  it('falls back when the path is empty', () => {
    expect(projectNameFromPath('')).toBe('Project');
    expect(projectNameFromPath('   ')).toBe('Project');
  });
});
