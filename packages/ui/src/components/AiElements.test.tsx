import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtImage,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from './ChainOfThought';
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from './Confirmation';
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationQuote,
  InlineCitationSource,
  InlineCitationText,
} from './InlineCitation';
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanStep,
  PlanTitle,
  PlanTrigger,
} from './Plan';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './Reasoning';
import { Task, TaskContent, TaskItem, TaskItemFile, TaskTrigger } from './Task';
import {
  Source,
  SourceItem,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from './Sources';
import { Suggestion, SuggestionItem, Suggestions } from './Suggestion';
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

    expect(screen.getByText('Thinking...')).toHaveClass('ui-ai-shimmer', 'custom-shimmer');
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

  it('maps tool states to badge labels with status icons', () => {
    render(() => getStatusBadge('output-available'));
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="tool-status-badge"]')).toBeInTheDocument();
  });

  it('derives tool title from type when title is omitted', () => {
    render(() => (
      <Tool state="input-streaming" defaultOpen>
        <ToolHeader type="tool-read" state="input-streaming" />
        <ToolContent>
          <ToolInput input={{ path: 'README.md' }} />
        </ToolContent>
      </Tool>
    ));

    expect(screen.getByText('read')).toBeInTheDocument();
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
      <Suggestions>
        <SuggestionItem suggestion="Summarize this" onClick={onClick} />
        <SuggestionItem suggestion="Draft a reply" onClick={onClick} />
      </Suggestions>
    ));

    expect(document.querySelector('[data-slot="suggestion"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summarize this' })).toHaveClass('rounded-full', 'px-16');
    expect(screen.getByRole('button', { name: 'Draft a reply' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Summarize this' }));
    expect(onClick).toHaveBeenCalledWith('Summarize this');
  });

  it('exports Suggestion as an alias for the scroll container', () => {
    render(() => (
      <Suggestion>
        <SuggestionItem suggestion="One" />
      </Suggestion>
    ));

    expect(document.querySelector('[data-slot="suggestion"]')).toBeInTheDocument();
  });
});

describe('Sources', () => {
  it('renders a collapsible source list with count in the trigger', () => {
    render(() => (
      <Sources defaultOpen>
        <SourcesTrigger count={2} />
        <SourcesContent>
          <SourceItem href="https://example.com/docs" title="Example Docs" />
          <Source href="https://example.org/guide" title="Guide" />
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
        <InlineCitationText>Supporting claim</InlineCitationText>
        <InlineCitationCard open>
          <InlineCitationCardTrigger sources={['https://example.com/article', 'https://docs.example.com']} />
          <InlineCitationCardBody>
            <InlineCitationQuote>Relevant excerpt from the source.</InlineCitationQuote>
          </InlineCitationCardBody>
        </InlineCitationCard>
      </InlineCitation>
    ));

    expect(screen.getByText('Supporting claim')).toHaveClass('group-hover:bg-interaction-hover');
    expect(screen.getByText('example.com +1')).toBeInTheDocument();
    expect(screen.getByText('Relevant excerpt from the source.')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="inline-citation-quote"]')).toHaveClass('italic');
  });

  it('renders carousel navigation for multiple citation sources', async () => {
    render(() => (
      <InlineCitationCard open>
        <InlineCitationCardTrigger sources={['https://a.example', 'https://b.example']} />
        <InlineCitationCardBody>
          <InlineCitationCarousel>
            <InlineCitationCarouselHeader>
              <InlineCitationCarouselPrev />
              <InlineCitationCarouselNext />
              <InlineCitationCarouselIndex />
            </InlineCitationCarouselHeader>
            <InlineCitationCarouselContent>
              <InlineCitationCarouselItem>
                <InlineCitationSource title="Source A" url="https://a.example" description="First source" />
              </InlineCitationCarouselItem>
              <InlineCitationCarouselItem>
                <InlineCitationSource title="Source B" url="https://b.example" description="Second source" />
              </InlineCitationCarouselItem>
            </InlineCitationCarouselContent>
          </InlineCitationCarousel>
        </InlineCitationCardBody>
      </InlineCitationCard>
    ));

    expect(screen.getByText('Source A')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous')).toBeInTheDocument();
    expect(screen.getByLabelText('Next')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('[data-slot="inline-citation-carousel-index"]')).toHaveTextContent('1/2');
    });

    fireEvent.click(screen.getByLabelText('Next'));
    await waitFor(() => {
      expect(document.querySelector('[data-slot="inline-citation-carousel-index"]')).toHaveTextContent('2/2');
    });
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

  it('renders search result badges and image caption', () => {
    render(() => (
      <ChainOfThought defaultOpen>
        <ChainOfThoughtHeader />
        <ChainOfThoughtContent>
          <ChainOfThoughtStep label="Search">
            <ChainOfThoughtSearchResults>
              <ChainOfThoughtSearchResult>docs/architecture.md</ChainOfThoughtSearchResult>
            </ChainOfThoughtSearchResults>
          </ChainOfThoughtStep>
          <ChainOfThoughtImage caption="Diagram preview">
            <img src="/demo.png" alt="Demo diagram" />
          </ChainOfThoughtImage>
        </ChainOfThoughtContent>
      </ChainOfThought>
    ));

    expect(
      screen.getByText('docs/architecture.md').closest('[data-slot="chain-of-thought-search-result"]'),
    ).toBeInTheDocument();
    expect(screen.getByText('Diagram preview')).toBeInTheDocument();
    expect(document.querySelector('.ui-chain-of-thought-image-frame')).toBeInTheDocument();
  });
});

describe('Plan', () => {
  it('renders collapsible plan steps with streaming shimmer on title and description', () => {
    render(() => (
      <Plan defaultOpen isStreaming>
        <PlanHeader>
          <div class="min-w-0 flex-1 space-y-4">
            <PlanTitle>Implementation plan</PlanTitle>
            <PlanDescription>Updating UI package components</PlanDescription>
          </div>
          <PlanAction>
            <PlanTrigger />
          </PlanAction>
        </PlanHeader>
        <PlanContent>
          <PlanStep label="Scan repository" status="complete" />
          <PlanStep label="Draft changes" status="active" description="Updating UI package" />
        </PlanContent>
      </Plan>
    ));

    expect(screen.getByText('Implementation plan')).toHaveAttribute('data-slot', 'shimmer');
    expect(screen.getByText('Updating UI package components')).toHaveAttribute('data-slot', 'shimmer');
    expect(screen.getByText('Scan repository')).toBeInTheDocument();
    expect(screen.getByText('Draft changes')).toBeInTheDocument();

    const steps = document.querySelectorAll('[data-slot="plan-step"]');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveAttribute('data-status', 'complete');
    expect(steps[1]).toHaveAttribute('data-status', 'active');
    expect(document.querySelector('[data-slot="plan"]')).toHaveClass('rounded-8', 'border-border-subtle');
  });

  it('collapses plan content from the trigger', () => {
    render(() => (
      <Plan defaultOpen>
        <PlanHeader>
          <PlanTitle>Plan</PlanTitle>
          <PlanAction>
            <PlanTrigger />
          </PlanAction>
        </PlanHeader>
        <PlanContent>
          <PlanStep label="Step one" />
        </PlanContent>
      </Plan>
    ));

    const trigger = screen.getByRole('button', { name: 'Toggle plan' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Task', () => {
  it('renders a collapsible search task with file chips', () => {
    render(() => (
      <Task defaultOpen>
        <TaskTrigger title="Searching documentation" />
        <TaskContent>
          <TaskItem>
            Found references in <TaskItemFile>architecture.md</TaskItemFile>
          </TaskItem>
          <TaskItem>
            Matched <TaskItemFile>terminology.md</TaskItemFile>
          </TaskItem>
        </TaskContent>
      </Task>
    ));

    expect(screen.getByText('Searching documentation')).toBeInTheDocument();
    expect(screen.getByText('architecture.md')).toBeInTheDocument();
    expect(screen.getByText('terminology.md')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="task-item-file"]')).toHaveClass('rounded-6');
  });

  it('collapses task content from the trigger', () => {
    render(() => (
      <Task defaultOpen>
        <TaskTrigger title="Inspect files" />
        <TaskContent>
          <TaskItem>Read package manifest</TaskItem>
        </TaskContent>
      </Task>
    ));

    const trigger = screen.getByRole('button', { name: 'Inspect files' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
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
        <ConfirmationRequest>
          <ConfirmationTitle>Approve file write?</ConfirmationTitle>
          <ConfirmationActions>
            <ConfirmationAction variant="primary">Approve</ConfirmationAction>
            <ConfirmationAction variant="danger">Deny</ConfirmationAction>
          </ConfirmationActions>
        </ConfirmationRequest>
      </Confirmation>
    ));

    expect(screen.getByText('Approve file write?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('shows accepted and rejected states after response', () => {
    render(() => (
      <>
        <Confirmation approval={{ id: 'approval-1', approved: true }} state="approval-responded">
          <ConfirmationAccepted>
            <ConfirmationTitle>Write approved</ConfirmationTitle>
          </ConfirmationAccepted>
          <ConfirmationActions>
            <ConfirmationAction>Approve</ConfirmationAction>
          </ConfirmationActions>
        </Confirmation>
        <Confirmation approval={{ id: 'approval-2', approved: false }} state="output-denied">
          <ConfirmationRejected>
            <ConfirmationTitle>Write denied</ConfirmationTitle>
          </ConfirmationRejected>
        </Confirmation>
      </>
    ));

    expect(screen.getByText('Write approved')).toBeInTheDocument();
    expect(screen.getByText('Write denied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});

