import { createSignal } from 'solid-js';
import { normalizeWorkspaceRelativePath } from '@/features/chat/tool-file-link';
import { openFilePreview } from './resource-store';
import { projectSessions, projects, selectedSessionId } from '@/store';

export type ResourceWorkbenchRequest = {
  nonce: number;
  view: 'explorer';
  activePath?: string;
};

export const [resourceWorkbenchRequest, setResourceWorkbenchRequest] = createSignal<ResourceWorkbenchRequest | null>(null);

function activeProjectCwd(): string | undefined {
  const sessionId = selectedSessionId();
  const session = projectSessions().find((item) => item.id === sessionId);
  const project = projects().find((item) => item.id === session?.projectId);
  return project?.cwd;
}

/** 从工具调用打开右侧 Explorer 并预览文件。 */
export function openWorkspaceFromTool(rawPath: string): void {
  const path = normalizeWorkspaceRelativePath(rawPath, activeProjectCwd());
  if (!path) return;
  setResourceWorkbenchRequest({ nonce: Date.now(), view: 'explorer', activePath: path });
  openFilePreview(path);
}
