// 下行帧路由表：按帧族委托 feature handleDownstream，语义与拆分前 store.onFrame 一致。
import type * as H from '@/shared/protocol/client';

export type DownstreamFamily = {
  handleDownstream: (frame: H.DownstreamFrame) => void;
};

export type StoreDownstreamFamilies = {
  connection: DownstreamFamily;
  resource: DownstreamFamily;
  session: DownstreamFamily;
  mcp: DownstreamFamily;
  terminal: DownstreamFamily;
};

export function createOnFrame(families: StoreDownstreamFamilies): (frame: H.DownstreamFrame) => void {
  const { connection, resource, session, mcp, terminal } = families;
  return function onFrame(frame: H.DownstreamFrame): void {
    switch (frame.t) {
      case 'ysync.update':
        resource.handleDownstream(frame);
        break;
      case 'resource_result':
        resource.handleDownstream(frame);
        break;
      case 'action_ack':
        connection.handleDownstream(frame);
        break;
      case 'action_error':
        connection.handleDownstream(frame);
        break;
      case 'prompt_status':
        session.handleDownstream(frame);
        break;
      case 'rewind_candidates':
        session.handleDownstream(frame);
        break;
      case 'rewind_preview':
        session.handleDownstream(frame);
        break;
      case 'mcp_servers':
        mcp.handleDownstream(frame);
        break;
      case 'mcp_oauth':
        mcp.handleDownstream(frame);
        break;
      case 'mcp_oauth_authorization':
        mcp.handleDownstream(frame);
        break;
      case 'mcp_app_session':
        mcp.handleDownstream(frame);
        break;
      case 'mcp_app_resource':
        mcp.handleDownstream(frame);
        break;
      case 'mcp_app_call_result':
        mcp.handleDownstream(frame);
        break;
      case 'terminal_opened':
        terminal.handleDownstream(frame);
        break;
      case 'terminal_output':
        terminal.handleDownstream(frame);
        break;
      case 'terminal_exit':
        terminal.handleDownstream(frame);
        break;
      case 'terminal_error':
        terminal.handleDownstream(frame);
        break;
      case 'auth_error':
        connection.handleDownstream(frame);
        break;
      default:
        break; // 未知帧忽略（协议演进兼容）
    }
  };
}
