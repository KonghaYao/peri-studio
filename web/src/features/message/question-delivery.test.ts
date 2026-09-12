import { beforeEach, describe, expect, it } from 'vitest';
import type { PendingQuestion } from '@/entities/chat/control-view';
import {
  completeQuestionResponse,
  markQuestionResponseUncertain,
  questionResponses,
  resetQuestionResponses,
  retainProjectedQuestions,
  startQuestionResponse,
} from './question-delivery';

const item = (questionId: string): PendingQuestion => ({
  questionId,
  status: 'pending',
  description: 'Please answer',
  expiresAt: null,
  questions: [{
    question: 'Pick one',
    header: null,
    multiSelect: false,
    options: [{ label: 'A', description: null }],
  }],
});

describe('question delivery', () => {
  beforeEach(resetQuestionResponses);

  it('clears pending delivery when the authority removes the question after accept', () => {
    startQuestionResponse('q1', 'command-1');
    retainProjectedQuestions([]);
    expect(questionResponses()).toEqual({});
  });

  it('keeps uncertain delivery evidence after the authority removes the question', () => {
    startQuestionResponse('q1', 'command-1');
    markQuestionResponseUncertain('command-1', 'delivery_unknown');
    retainProjectedQuestions([]);
    expect(questionResponses().q1).toMatchObject({
      commandId: 'command-1',
      phase: 'delivery_unknown',
      dismissed: false,
    });
  });

  it('completes delivery when a committed ack arrives', () => {
    startQuestionResponse('q1', 'command-1');
    completeQuestionResponse('command-1');
    expect(questionResponses().q1).toMatchObject({ commandId: 'command-1', phase: 'confirmed' });
    retainProjectedQuestions([item('q1')]);
    expect(questionResponses()).toHaveProperty('q1');
  });
});
