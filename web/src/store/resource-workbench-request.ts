import { createSignal } from 'solid-js';
import {
  openWorkspaceFromTool as openWorkspaceFromToolCore,
  type ResourceWorkbenchRequest,
} from '@/features/resource/open-workspace-from-tool';
import { activateResourceProject, openFilePreview } from '@/features/resource/resource-store';

export type { ResourceWorkbenchRequest };

export const [resourceWorkbenchRequest, setResourceWorkbenchRequest] = createSignal<ResourceWorkbenchRequest | null>(null);

let resolveProjectCwd: () => string | undefined = () => undefined;
let resolveProjectId: () => string | undefined = () => undefined;

export function installResourceWorkbenchPorts(ports: {
  projectCwd: () => string | undefined;
  projectId: () => string | undefined;
}): void {
  resolveProjectCwd = ports.projectCwd;
  resolveProjectId = ports.projectId;
}

/** 从工具调用打开右侧 Explorer 并预览文件。 */
export function openWorkspaceFromTool(rawPath: string): void {
  openWorkspaceFromToolCore(rawPath, {
    projectId: resolveProjectId,
    projectCwd: resolveProjectCwd,
    activateResourceProject,
    requestWorkbench: setResourceWorkbenchRequest,
    openFilePreview,
  });
}
