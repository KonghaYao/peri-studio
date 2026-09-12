import { createMemo, createSignal, type Accessor } from 'solid-js';
import { ToolActivityRow } from '@peri/ui';
import type { ToolCallInfo } from '@/entities/chat/chat-view';
import { buildToolCallRowProps } from '@/features/chat/tool-call-activity';
import { openWorkspaceFromTool } from '@/store';

type ToolCallSource = ToolCallInfo | Accessor<ToolCallInfo>;

/** Hub tool call → @peri/ui ToolActivityRow（业务映射在 features 层）。 */
export function ToolCallActivity(props: {
  toolCall: ToolCallSource;
  variant?: 'default' | 'activity';
  projectCwd?: string | null;
}) {
  const [evidenceLoaded, setEvidenceLoaded] = createSignal(false);
  const tool = () => (typeof props.toolCall === 'function' ? props.toolCall() : props.toolCall);
  const rowProps = createMemo(() => buildToolCallRowProps(tool(), {
    variant: props.variant,
    projectCwd: props.projectCwd,
    evidenceLoaded: evidenceLoaded(),
    onOpenEvidence: () => setEvidenceLoaded(true),
    onOpenWorkspacePath: openWorkspaceFromTool,
  }));

  return <ToolActivityRow {...rowProps()} />;
}
