import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingQuestion } from '@/entities/chat/control-view';
import { resetQuestionResponses } from '@/features/message/question-delivery';
import { QuestionQueue } from './QuestionQueue';

const QUESTION: PendingQuestion = {
  questionId: 'q-1',
  status: 'pending',
  description: null,
  expiresAt: null,
  questions: [
    {
      header: '下一步',
      question: '你希望接下来优先处理哪类任务？',
      multiSelect: false,
      options: [
        { label: '继续 peri-studio 功能/修复', description: '在仓库内改代码、跑测试、对齐架构文档' },
        { label: '解释或梳理现有代码', description: '只读分析，不写代码' },
      ],
    },
    {
      header: null,
      question: '需要额外说明吗？',
      multiSelect: false,
      options: [
        { label: '不需要', description: null },
        { label: '需要', description: null },
      ],
    },
  ],
};

afterEach(() => {
  resetQuestionResponses();
  vi.restoreAllMocks();
});

describe('QuestionQueue', () => {
  it('walks through questionnaire steps and submits ordered answers', async () => {
    const onRespond = vi.fn();

    render(() => (
      <QuestionQueue
        questions={[QUESTION]}
        responses={{}}
        readOnly={false}
        onRefreshStatus={() => undefined}
        onDismissUncertain={() => undefined}
        onRespond={onRespond}
      />
    ));

    expect(screen.getByText('下一步')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /继续 peri-studio 功能\/修复/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('需要额外说明吗？')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('radio', { name: /不需要/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onRespond).toHaveBeenCalledWith('q-1', [
      '继续 peri-studio 功能/修复',
      '不需要',
    ]);
  });

  it('does not lock the form before a response is in flight', () => {
    render(() => (
      <QuestionQueue
        questions={[QUESTION]}
        responses={{}}
        readOnly={false}
        onRefreshStatus={() => undefined}
        onDismissUncertain={() => undefined}
        onRespond={() => undefined}
      />
    ));

    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();
  });
});
