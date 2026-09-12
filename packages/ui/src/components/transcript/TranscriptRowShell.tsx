import { splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { useTranscriptRowMeasure } from './transcript-row-shell';
import { transcriptRowClass } from './transcript-layout';

export type TranscriptRowShellProps = {
  class?: string;
  id: string;
  position: number;
  size: number;
  onMeasure: (id: string, height: number) => void;
  children: JSX.Element;
};

/** T3 · 虚拟化 transcript 行壳：listitem 语义 + 变量高度测量 hook。 */
export const TranscriptRowShell: Component<TranscriptRowShellProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'id', 'position', 'size', 'onMeasure', 'children']);
  const rowRef = useTranscriptRowMeasure(local.id, local.onMeasure);

  return (
    <div
      {...rest}
      ref={rowRef}
      class={cn(transcriptRowClass, local.class)}
      role="listitem"
      aria-posinset={local.position}
      aria-setsize={local.size}
      data-transcript-id={local.id}
    >
      {local.children}
    </div>
  );
};
