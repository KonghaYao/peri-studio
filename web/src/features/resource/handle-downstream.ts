// ysync.update / resource_result 下行帧（store 组合根委托）。
import type * as H from '@/shared/protocol/client';
import type { DocStore } from '../../panel/lib/doc-store';
import type { ResourceResultFrame } from '../../panel/lib/resource-protocol';
import type { DeleteConfirmResultFrame } from '@/shared/protocol/resource-fs-mutation';

export type ResourceDownstreamDeps = {
  docStore: DocStore;
  forwardRemoteDirectoryResourceUpdate: (frame: { doc: string; update: string }) => boolean;
  forwardRemoteDirectoryResourceResult: (frame: ResourceResultFrame) => boolean;
  forwardWorkspaceUploadResourceResult: (frame: ResourceResultFrame) => boolean;
  forwardFsMutationResourceResult: (frame: DeleteConfirmResultFrame) => boolean;
  handleResourceUpdate: (frame: { doc: string; update: string }) => boolean;
  handleResourceResult: (frame: ResourceResultFrame) => void;
};

export function createResourceDownstream(deps: ResourceDownstreamDeps) {
  function handleDownstream(frame: H.DownstreamFrame): void {
    switch (frame.t) {
      case 'ysync.update':
        if (deps.forwardRemoteDirectoryResourceUpdate(frame as { doc: string; update: string })) break;
        if (!deps.handleResourceUpdate(frame as { doc: string; update: string })) {
          deps.docStore.applyUpdateFrame(frame as { doc: string; update: string });
        }
        break;
      case 'resource_result':
        if (deps.forwardRemoteDirectoryResourceResult(frame as ResourceResultFrame)) break;
        if (deps.forwardWorkspaceUploadResourceResult(frame as ResourceResultFrame)) break;
        if (deps.forwardFsMutationResourceResult(frame as DeleteConfirmResultFrame)) break;
        deps.handleResourceResult(frame as ResourceResultFrame);
        break;
      default:
        break;
    }
  }

  return { handleDownstream };
}
