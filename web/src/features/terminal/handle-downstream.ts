// terminal_* 下行帧（store 组合根委托）。
import type * as H from '@/shared/protocol/client';
import type { TerminalDownstreamFrame } from '@/shared/protocol/terminal';
import { handleTerminalFrame } from '@/features/terminal/terminal-session';

export function createTerminalDownstream() {
  function handleDownstream(frame: H.DownstreamFrame): void {
    switch (frame.t) {
      case 'terminal_opened':
        handleTerminalFrame(frame as TerminalDownstreamFrame);
        break;
      case 'terminal_output':
        handleTerminalFrame(frame as TerminalDownstreamFrame);
        break;
      case 'terminal_exit':
        handleTerminalFrame(frame as TerminalDownstreamFrame);
        break;
      case 'terminal_error':
        handleTerminalFrame(frame as TerminalDownstreamFrame);
        break;
      default:
        break;
    }
  }

  return { handleDownstream };
}
