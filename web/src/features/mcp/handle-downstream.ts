// mcp_* 下行帧（store 组合根委托）。
import type * as H from '@/shared/protocol/client';
import { handleMcpOAuth, handleMcpOAuthAuthorization, handleMcpServers } from '../../panel/lib/mcp';
import { handleMcpAppCallResult, handleMcpAppResource, handleMcpAppSession } from '../../panel/lib/mcp-apps';

export function createMcpDownstream() {
  function handleDownstream(frame: H.DownstreamFrame): void {
    switch (frame.t) {
      case 'mcp_servers':
        handleMcpServers(frame);
        break;
      case 'mcp_oauth':
        handleMcpOAuth(frame);
        break;
      case 'mcp_oauth_authorization':
        handleMcpOAuthAuthorization(frame);
        break;
      case 'mcp_app_session':
        handleMcpAppSession(frame);
        break;
      case 'mcp_app_resource':
        handleMcpAppResource(frame);
        break;
      case 'mcp_app_call_result':
        handleMcpAppCallResult(frame);
        break;
      default:
        break;
    }
  }

  return { handleDownstream };
}
