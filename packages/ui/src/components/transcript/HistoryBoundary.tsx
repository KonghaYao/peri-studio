import { splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import {
  transcriptHistoryBoundaryClass,
  transcriptHistoryBoundaryLineClass,
} from './transcript-layout';

export type TranscriptHistoryBoundaryKind = 'verified_history' | 'live_runtime';

export type HistoryBoundaryProps = {
  class?: string;
  kind: TranscriptHistoryBoundaryKind;
  'data-testid'?: string;
};

function labelFor(kind: TranscriptHistoryBoundaryKind) {
  return kind === 'live_runtime' ? 'Current' : 'Verified history';
}

function accessibleLabelFor(kind: TranscriptHistoryBoundaryKind) {
  return kind === 'live_runtime' ? 'Current run' : 'Peri-verified recovered history';
}

/** T3 · Transcript 历史分界：verified 恢复段与 live runtime 之间的视觉/语义分隔。 */
export const HistoryBoundary: Component<HistoryBoundaryProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'kind']);
  const accessibleLabel = () => accessibleLabelFor(local.kind);

  return (
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'history-boundary'}
      class={cn(transcriptHistoryBoundaryClass, local.class)}
      role="separator"
      aria-label={accessibleLabel()}
      title={accessibleLabel()}
    >
      <span class={transcriptHistoryBoundaryLineClass} aria-hidden="true" />
      <span class="whitespace-nowrap">{labelFor(local.kind)}</span>
      <span class={transcriptHistoryBoundaryLineClass} aria-hidden="true" />
    </div>
  );
};
