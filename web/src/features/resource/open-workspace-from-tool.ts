import { normalizeWorkspaceRelativePath } from '@/features/chat/tool-file-link';

export type ResourceWorkbenchRequest = {
  nonce: number;
  view: 'explorer';
  activePath?: string;
};

export type OpenWorkspaceFromToolPorts = {
  projectCwd: () => string | undefined;
  requestWorkbench: (request: ResourceWorkbenchRequest) => void;
  openFilePreview: (path: string) => void;
};

/** 从工具调用打开右侧 Explorer 并预览文件。 */
export function openWorkspaceFromTool(rawPath: string, ports: OpenWorkspaceFromToolPorts): void {
  const path = normalizeWorkspaceRelativePath(rawPath, ports.projectCwd());
  if (!path) return;
  ports.requestWorkbench({ nonce: Date.now(), view: 'explorer', activePath: path });
  ports.openFilePreview(path);
}
