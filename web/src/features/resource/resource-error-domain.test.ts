import { describe, expect, it } from 'vitest';
import { resourceErrorDomain, resourceWorkspaceErrorForView } from './resource-error-domain';

describe('resourceErrorDomain', () => {
  it('routes git log failures to the graph domain', () => {
    expect(resourceErrorDomain('log:repo-1:start')).toBe('graph');
    expect(resourceErrorDomain('directory:')).toBe('explorer');
  });
});

describe('resourceWorkspaceErrorForView', () => {
  it('filters errors by active workbench view', () => {
    const state = { explorerError: 'Explorer failed', graphError: 'Graph failed' };
    expect(resourceWorkspaceErrorForView(state, 'explorer')).toBe('Explorer failed');
    expect(resourceWorkspaceErrorForView(state, 'scm')).toBe('Explorer failed');
    expect(resourceWorkspaceErrorForView(state, 'graph')).toBe('Graph failed');
  });
});
