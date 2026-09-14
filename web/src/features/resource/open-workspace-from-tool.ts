import { normalizeWorkspaceRelativePath } from '@/features/chat/tool-file-link';

export type ResourceWorkbenchRequest = {
  nonce: number;
  view: 'explorer';
  activePath?: string;
};

export type OpenWorkspaceFromToolPorts = {
  projectId: () => string | undefined;
  projectCwd: () => string | undefined;
  activateResourceProject: (projectId: string) => void;
  requestWorkbench: (request: ResourceWorkbenchRequest) => void;
  openFilePreview: (path: string) => void;
};

/** 从工具调用打开右侧 Explorer 并预览文件。 */
export function openWorkspaceFromTool(rawPath: string, ports: OpenWorkspaceFromToolPorts): void {
  const path = normalizeWorkspaceRelativePath(rawPath, ports.projectCwd());
  if (!path) return;
  const projectId = ports.projectId();
  if (!projectId) return;
  ports.activateResourceProject(projectId);
  ports.requestWorkbench({ nonce: Date.now(), view: 'explorer', activePath: path });
  ports.openFilePreview(path);
}
