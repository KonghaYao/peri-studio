import { beforeEach, describe, expect, it } from 'vitest';
import type { PendingElicitation } from './control-view';
import {
  completeElicitationResponse,
  dismissUncertainElicitation,
  elicitationResponses,
  markElicitationResponseUncertain,
  resetElicitationResponses,
  retainProjectedElicitations,
  startElicitationResponse,
  visibleElicitations,
} from './elicitation-delivery';

const item = (elicitationId: string): PendingElicitation => ({
  elicitationId,
  message: 'Choose',
  status: 'pending',
  responseAction: null,
  fields: [{ id: 'answer', title: 'Answer', description: null, kind: 'text', required: true, options: [] }],
  createdAt: null,
});

describe('elicitation delivery', () => {
  beforeEach(resetElicitationResponses);

  it('keeps one non-replayable command until the authority removes the elicitation', () => {
    expect(startElicitationResponse('e1', 'command-1')).toBe(true);
    expect(startElicitationResponse('e1', 'command-2')).toBe(false);
    completeElicitationResponse('another-command');
    expect(elicitationResponses().e1?.commandId).toBe('command-1');
    completeElicitationResponse('command-1');
    expect(elicitationResponses().e1).toMatchObject({ commandId: 'command-1', phase: 'confirmed' });
    expect(startElicitationResponse('e1', 'command-2')).toBe(false);
    retainProjectedElicitations([item('e1')]);
    expect(elicitationResponses()).toHaveProperty('e1');
    retainProjectedElicitations([]);
    expect(elicitationResponses()).toEqual({});
  });

  it('can hide an unknown result without releasing it for a second answer', () => {
    startElicitationResponse('e1', 'command-1');
    expect(dismissUncertainElicitation('e1')).toBe(false);
    markElicitationResponseUncertain('command-1', 'delivery_unknown');
    expect(dismissUncertainElicitation('e1')).toBe(true);

    expect(visibleElicitations([item('e1'), item('e2')]).map((entry) => entry.elicitationId)).toEqual(['e2']);
    expect(startElicitationResponse('e1', 'command-2')).toBe(false);
    expect(elicitationResponses().e1).toMatchObject({ commandId: 'command-1', dismissed: true });
  });

  it('releases hidden evidence only after the authority removes the elicitation', () => {
    startElicitationResponse('e1', 'command-1');
    markElicitationResponseUncertain('command-1', 'uncertain');
    dismissUncertainElicitation('e1');
    retainProjectedElicitations([item('e1')]);
    expect(elicitationResponses()).toHaveProperty('e1');
    retainProjectedElicitations([]);
    expect(elicitationResponses()).toEqual({});
  });

  it('recovers a responding server projection as unknown without enabling another answer', () => {
    retainProjectedElicitations([{ ...item('e1'), status: 'responding', responseAction: 'accept' }]);
    expect(elicitationResponses().e1).toEqual({ commandId: null, phase: 'delivery_unknown', dismissed: false });
    expect(startElicitationResponse('e1', 'command-2')).toBe(false);
  });
});
