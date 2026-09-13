import {
  HistoryBoundary,
  MessageScrollerItem,
  TranscriptRowShell,
  UserBubble,
} from '@peri/ui';
import { Markdown } from '@/components/blocks';
import { LONG_TRANSCRIPT_MARKDOWN } from '@/fixtures/long-transcript-markdown';
import { createStreamingReveal, type StreamingReveal } from '@/lib/streaming-demo';

/** Tier 4 · Conversation catalog：超长 assistant Markdown + 可选流式揭示。 */
export function ConversationTranscriptDemo(props: { reveal: StreamingReveal }) {
  const noopMeasure = () => {};

  return (
    <div class="flex w-full flex-col gap-16" role="list" aria-label="Conversation transcript">
      <MessageScrollerItem messageId="catalog-user-long-md" scrollAnchor>
        <TranscriptRowShell id="catalog-user-long-md" position={1} size={3} onMeasure={noopMeasure}>
          <UserBubble>Please demonstrate a very long markdown document in the conversation scroll area.</UserBubble>
        </TranscriptRowShell>
      </MessageScrollerItem>
      <HistoryBoundary kind="verified_history" />
      <MessageScrollerItem messageId="catalog-assistant-long-md">
        <TranscriptRowShell id="catalog-assistant-long-md" position={2} size={3} onMeasure={noopMeasure}>
          <Markdown source={props.reveal.text} streaming={props.reveal.streaming()} />
        </TranscriptRowShell>
      </MessageScrollerItem>
      <HistoryBoundary kind="live_runtime" />
      <MessageScrollerItem messageId="catalog-assistant-followup">
        <TranscriptRowShell id="catalog-assistant-followup" position={3} size={3} onMeasure={noopMeasure}>
          <div class="text-13 leading-normal text-content-primary">
            Scroll to the top or bottom to verify MessageScroller stickiness and the jump-to-end control.
          </div>
        </TranscriptRowShell>
      </MessageScrollerItem>
    </div>
  );
}

export function createConversationTranscriptReveal() {
  return createStreamingReveal(LONG_TRANSCRIPT_MARKDOWN);
}
