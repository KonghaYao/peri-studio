import { describe, expect, it } from 'vitest';
import { structuralMutationCapability } from './fs-mutations';

const projects = [{ id: 'project-1', instanceId: 'instance-1' }];

function instance(overrides: Partial<{
  status: string;
  resourceProtocolVersion: number;
  resourceWrite: boolean;
  resourceStructuralMutations: boolean;
}> = {}) {
  return [{
    id: 'instance-1',
    status: 'online',
    resourceProtocolVersion: 5,
    resourceWrite: true,
    resourceStructuralMutations: true,
    ...overrides,
  }];
}

describe('filesystem structural capability', () => {
  it('requires an online v5 write-capable instance with the optional structural capability', () => {
    expect(structuralMutationCapability('project-1', projects, instance())).toBe(true);
    expect(structuralMutationCapability('project-1', projects, instance({ status: 'offline' }))).toBe(false);
    expect(structuralMutationCapability('project-1', projects, instance({ resourceProtocolVersion: 4 }))).toBe(false);
    expect(structuralMutationCapability('project-1', projects, instance({ resourceWrite: false }))).toBe(false);
    expect(structuralMutationCapability('project-1', projects, instance({ resourceStructuralMutations: false }))).toBe(false);
    expect(structuralMutationCapability('missing', projects, instance())).toBe(false);
  });
});
