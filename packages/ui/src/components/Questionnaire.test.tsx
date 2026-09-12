import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Questionnaire,
  QuestionnaireNavigation,
  QuestionnaireProgress,
  QuestionnaireStep,
} from './Questionnaire';

afterEach(() => cleanup());

describe('Questionnaire', () => {
  it('walks through single-choice steps and submits answers', async () => {
    const onSubmit = vi.fn();

    render(() => (
      <Questionnaire onSubmit={onSubmit}>
        <QuestionnaireProgress aria-label="Progress" />
        <QuestionnaireStep
          id="direction"
          title="What should we build?"
          description="Choose a direction."
          required
          choices={[
            { value: 'timeline', label: 'Tool call timeline' },
            { value: 'approval', label: 'Approval checkpoints' },
          ]}
        />
        <QuestionnaireStep
          id="detail"
          title="How much detail?"
          choices={[
            { value: 'focused', label: 'Focused' },
            { value: 'complete', label: 'Complete flow' },
          ]}
        />
        <QuestionnaireNavigation />
      </Questionnaire>
    ));

    await waitFor(() => {
      expect(screen.getByRole('progressbar', { name: 'Progress' })).toBeInTheDocument();
      expect(screen.getByText('What should we build?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('radio', { name: /Tool call timeline/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('How much detail?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('radio', { name: /Complete flow/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).toHaveBeenCalledWith({
      direction: 'timeline',
      detail: 'complete',
    });
  });

  it('supports multiple choice, freeform text, and skipping optional steps', async () => {
    const onSubmit = vi.fn();

    render(() => (
      <Questionnaire onSubmit={onSubmit}>
        <QuestionnaireStep
          id="sources"
          title="Which sources?"
          required
          multiple
          choices={[
            { value: 'repo', label: 'Repository' },
            { value: 'docs', label: 'Docs' },
          ]}
        />
        <QuestionnaireStep
          id="notes"
          title="Anything else?"
          allowText
          textLabel="Additional notes"
          textPlaceholder="Type notes"
        />
        <QuestionnaireStep
          id="optional"
          title="Optional preference"
          choices={[{ value: 'fast', label: 'Fast' }]}
        />
        <QuestionnaireNavigation />
      </Questionnaire>
    ));

    await waitFor(() => {
      expect(screen.getByText('Which sources?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /Repository/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Docs/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Additional notes')).toBeInTheDocument();
    });

    fireEvent.input(screen.getByLabelText('Additional notes'), {
      target: { value: 'Check tests first' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Optional preference')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSubmit).toHaveBeenCalledWith({
      sources: ['repo', 'docs'],
      notes: 'Check tests first',
      optional: null,
    });
  });

  it('shows skip on required steps and advances without an answer', async () => {
    const onSubmit = vi.fn();

    render(() => (
      <Questionnaire onSubmit={onSubmit}>
        <QuestionnaireStep
          id="scope"
          title="What may change?"
          required
          choices={[{ value: 'component', label: 'Target component' }]}
        />
        <QuestionnaireStep
          id="checks"
          title="Which checks?"
          required
          choices={[{ value: 'tests', label: 'Tests' }]}
        />
        <QuestionnaireNavigation />
      </Questionnaire>
    ));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => {
      expect(screen.getByText('Which checks?')).toBeInTheDocument();
    });
  });

  it('blocks next on required questions and allows previous navigation', async () => {
    render(() => (
      <Questionnaire>
        <QuestionnaireStep
          id="scope"
          title="What may change?"
          required
          choices={[{ value: 'component', label: 'Target component' }]}
        />
        <QuestionnaireStep
          id="checks"
          title="Which checks?"
          choices={[{ value: 'tests', label: 'Tests' }]}
        />
        <QuestionnaireNavigation />
      </Questionnaire>
    ));

    await waitFor(() => {
      expect(screen.getByText('What may change?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an answer to continue.');

    fireEvent.click(screen.getByRole('radio', { name: /Target component/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('Which checks?')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));

    await waitFor(() => {
      expect(screen.getByText('What may change?')).toBeInTheDocument();
    });
  });
});
