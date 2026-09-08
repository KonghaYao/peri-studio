// prompt_status / rewind_* 下行帧（store 组合根委托）。
import type * as H from '@/shared/protocol/client';
import { handlePromptStatus } from '@/features/runtime/prompt-recovery-assembly';
import { handleRewindCandidates, handleRewindPreview } from '@/features/runtime/rewind-assembly';

export function createSessionDownstream() {
  function handleDownstream(frame: H.DownstreamFrame): void {
    switch (frame.t) {
      case 'prompt_status':
        handlePromptStatus(frame);
        break;
      case 'rewind_candidates':
        handleRewindCandidates(frame);
        break;
      case 'rewind_preview':
        handleRewindPreview(frame);
        break;
      default:
        break;
    }
  }

  return { handleDownstream };
}
