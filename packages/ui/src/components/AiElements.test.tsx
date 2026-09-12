import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from './ChainOfThought';
import {
  Confirmation,
  ConfirmationActions,
  ConfirmationTitle,
} from './Confirmation';
import { Plan, PlanContent, PlanHeader, PlanStep } from './Plan';
import { Queue, QueueItem, QueueItemIndicator } from './Queue';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './Reasoning';
import { Task, TaskItem, TaskItemDescription, TaskItemTitle } from './Task';
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationQuote,
} from './InlineCitation';
import {
  SourceItem,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from './Sources';
import { Suggestion, SuggestionItem } from './Suggestion';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  getStatusBadge,
} from './Tool';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Reasoning', () => {
  it('opens while streaming and auto-closes after streaming ends', async () => {
    vi.useFakeTimers();
    const [streaming, setStreaming] = createSignal(true);

    render(() => (
      <Reasoning isStreaming={streaming()}>
        <ReasoningTrigger />
        <ReasoningContent>Hidden reasoning text</ReasoningContent>
      </Reasoning>
    ));

    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hidden reasoning text')).toBeInTheDocument();

    setStreaming(false);
    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    vi.advanceTimersByTime(1000);
    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('respects autoClose=false', async () => {
    vi.useFakeTimers();
    const [streaming, setStreaming] = createSignal(true);

    render(() => (
      <Reasoning isStreaming={streaming()} autoClose={false}>
        <ReasoningTrigger />
        <ReasoningContent>Still visible</ReasoningContent>
      </Reasoning>
    ));

    const trigger = screen.getByRole('button');
    setStreaming(false);
    vi.advanceTimersByTime(1500);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Still visible')).toBeInTheDocument();
  });

  it('applies shimmer class while streaming', () => {
    render(() => (
      <Reasoning isStreaming>
        <ReasoningTrigger shimmerClass="custom-shimmer" />
        <ReasoningContent>Body</ReasoningContent>
      </Reasoning>
    ));

    expect(screen.getByText('Thinking')).toHaveClass('custom-shimmer');
  });
});

describe('Tool', () => {
  it('exposes lifecycle state on the root and status badge in the header', () => {
    render(() => (
      <Tool state="input-streaming" defaultOpen>
        <ToolHeader title="fetch_weather" state="input-streaming" />
        <ToolContent>
          <ToolInput input={{ city: 'Tokyo' }} />
        </ToolContent>
      </Tool>
    ));

    const root = document.querySelector('[data-slot="tool"]');
    expect(root).toHaveAttribute('data-state', 'input-streaming');
    expect(root).toHaveClass('rounded-8', 'border-border-subtle', 'bg-surface');
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('fetch_weather')).toBeInTheDocument();
    expect(screen.getByText(/"city": "Tokyo"/)).toBeInTheDocument();
  });

  it('renders output and error sections', () => {
    render(() => (
      <Tool state="output-error" defaultOpen>
        <ToolHeader title="search" state="output-error" />
        <ToolContent>
          <ToolOutput errorText="Upstream timeout" />
        </ToolContent>
      </Tool>
    ));

    expect(screen.getByText('Upstream timeout')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="tool-output"]')).toHaveTextContent('Error');
  });

  it('maps tool states to badge labels', () => {
    render(() => getStatusBadge('output-available'));
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('toggles tool details from the header trigger', () => {
    render(() => (
      <Tool state="output-available">
        <ToolHeader title="read_file" state="output-available" />
        <ToolContent>
          <ToolOutput output={{ ok: true }} />
        </ToolContent>
      </Tool>
    ));

    const trigger = screen.getByRole('button', { name: /read_file/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('"ok"')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
  });
});

describe('Suggestion', () => {
  it('renders suggestion chips and forwards click with suggestion text', () => {
    const onClick = vi.fn();

    render(() => (
      <Suggestion>
        <SuggestionItem suggestion="Summarize this" onClick={onClick} />
        <SuggestionItem suggestion="Draft a reply" onClick={onClick} />
      </Suggestion>
    ));

    expect(document.querySelector('[data-slot="suggestion"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summarize this' })).toHaveClass('rounded-full');
    expect(screen.getByRole('button', { name: 'Draft a reply' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Summarize this' }));
    expect(onClick).toHaveBeenCalledWith('Summarize this');
  });
});

describe('Sources', () => {
  it('renders a collapsible source list with count in the trigger', () => {
    render(() => (
      <Sources defaultOpen>
        <SourcesTrigger count={2} />
        <SourcesContent>
          <SourceItem href="https://example.com/docs" title="Example Docs" />
          <SourceItem href="https://example.org/guide" title="Guide" />
        </SourcesContent>
      </Sources>
    ));

    expect(screen.getByRole('button', { name: /Used 2 sources/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Example Docs' })).toHaveAttribute('href', 'https://example.com/docs');
    expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute('target', '_blank');
  });

  it('collapses source content from the trigger', () => {
    render(() => (
      <Sources defaultOpen>
        <SourcesTrigger count={1} />
        <SourcesContent>
          <SourceItem href="https://example.com" title="Example" />
        </SourcesContent>
      </Sources>
    ));

    const trigger = screen.getByRole('button', { name: /Used 1 sources/i });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('InlineCitation', () => {
  it('shows hostname badge and quote content in the hover card', () => {
    render(() => (
      <InlineCitation>
        Supporting claim
        <InlineCitationCard open sources={['https://example.com/article', 'https://docs.example.com']}>
          <InlineCitationQuote>Relevant excerpt from the source.</InlineCitationQuote>
        </InlineCitationCard>
      </InlineCitation>
    ));

    expect(screen.getByText('Supporting claim')).toBeInTheDocument();
    expect(screen.getByText('example.com +1')).toBeInTheDocument();
    expect(screen.getByText('Relevant excerpt from the source.')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="inline-citation-quote"]')).toHaveClass('italic');
  });
});

describe('ChainOfThought', () => {
  it('renders a collapsible step list with connector metadata', () => {
    render(() => (
      <ChainOfThought defaultOpen>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <ChainOfThoughtStep label="Search docs" description="Looked up API limits" status="complete" />
          <ChainOfThoughtStep label="Draft answer" status="active" />
        </ChainOfThoughtContent>
      </ChainOfThought>
    ));

    expect(screen.getByText('Chain of Thought')).toBeInTheDocument();
    expect(screen.getByText('Search docs')).toBeInTheDocument();
    expect(screen.getByText('Draft answer')).toBeInTheDocument();

    const steps = document.querySelectorAll('[data-slot="chain-of-thought-step"]');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveAttribute('data-status', 'complete');
    expect(steps[1]).toHaveAttribute('data-status', 'active');
    expect(document.querySelector('.ui-chain-of-thought-connector')).toBeInTheDocument();
  });

  it('collapses content from the header trigger', () => {
    render(() => (
      <ChainOfThought defaultOpen>
        <ChainOfThoughtHeader>Reasoning steps</ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          <ChainOfThoughtStep label="Step one" />
        </ChainOfThoughtContent>
      </ChainOfThought>
    ));

    const trigger = screen.getByRole('button', { name: 'Reasoning steps' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Plan', () => {
  it('renders collapsible plan steps inside a card', () => {
    render(() => (
      <Plan defaultOpen isStreaming>
        <PlanHeader>Implementation plan</PlanHeader>
        <PlanContent>
          <PlanStep label="Scan repository" status="complete" />
          <PlanStep label="Draft changes" status="active" description="Updating UI package" />
        </PlanContent>
      </Plan>
    ));

    expect(screen.getByText('Implementation plan')).toHaveClass('shimmer');
    expect(screen.getByText('Scan repository')).toBeInTheDocument();
    expect(screen.getByText('Draft changes')).toBeInTheDocument();

    const steps = document.querySelectorAll('[data-slot="plan-step"]');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveAttribute('data-status', 'complete');
    expect(steps[1]).toHaveAttribute('data-status', 'active');
    expect(document.querySelector('[data-slot="plan"]')).toHaveClass('rounded-8', 'border-border-subtle');
  });

  it('collapses plan content from the header trigger', () => {
    render(() => (
      <Plan defaultOpen>
        <PlanHeader>Plan</PlanHeader>
        <PlanContent>
          <PlanStep label="Step one" />
        </PlanContent>
      </Plan>
    ));

    const trigger = screen.getByRole('button', { name: 'Plan' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Task', () => {
  it('renders checklist items with checkbox controls', () => {
    const onChange = vi.fn();
    render(() => (
      <Task>
        <TaskItem checked={false} onCheckedChange={onChange}>
          <TaskItemTitle>Write tests</TaskItemTitle>
          <TaskItemDescription>Cover plan and queue states</TaskItemDescription>
        </TaskItem>
      </Task>
    ));

    expect(screen.getByText('Write tests')).toBeInTheDocument();
    expect(screen.getByText('Cover plan and queue states')).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('Confirmation', () => {
  it('hides while tool input is still streaming', () => {
    render(() => (
      <Confirmation approval={{ id: 'approval-1' }} state="input-streaming">
        <ConfirmationTitle>Approve delete?</ConfirmationTitle>
      </Confirmation>
    ));

    expect(document.querySelector('[data-slot="confirmation"]')).not.toBeInTheDocument();
  });

  it('shows approval actions only when approval is requested', () => {
    render(() => (
      <Confirmation approval={{ id: 'approval-1' }} state="approval-requested">
        <ConfirmationTitle>Approve file write?</ConfirmationTitle>
        <ConfirmationActions state="approval-requested">
          <Button variant="primary">Approve</Button>
          <Button variant="danger">Deny</Button>
        </ConfirmationActions>
      </Confirmation>
    ));

    expect(screen.getByText('Approve file write?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('hides approval actions after a response', () => {
    render(() => (
      <Confirmation approval={{ id: 'approval-1', approved: true }} state="approval-responded">
        <ConfirmationTitle>Write approved</ConfirmationTitle>
        <ConfirmationActions state="approval-responded">
          <Button>Approve</Button>
        </ConfirmationActions>
      </Confirmation>
    ));

    expect(screen.getByText('Write approved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});

describe('Queue', () => {
  it('renders pending and completed queue indicators', () => {
    render(() => (
      <Queue>
        <QueueItem>
          <QueueItemIndicator />
          <span>Fetch weather</span>
        </QueueItem>
        <QueueItem>
          <QueueItemIndicator completed />
          <span>Read docs</span>
        </QueueItem>
      </Queue>
    ));

    const indicators = document.querySelectorAll('[data-slot="queue-item-indicator"]');
    expect(indicators).toHaveLength(2);
    expect(indicators[0]).toHaveAttribute('data-completed', 'false');
    expect(indicators[1]).toHaveAttribute('data-completed', 'true');
    expect(screen.getByText('Fetch weather')).toBeInTheDocument();
    expect(screen.getByText('Read docs')).toBeInTheDocument();
  });
});
