// 消息与持久化错误：自 features 再导出，供 @/store 单一入口消费。

export { refreshCurrentControlProjection, selectChat } from '@/features/connection/chat-subscription';
export {
  dismissPersistentError,
  reportTransportIssue,
  retryPersistentAction,
  retainPersistentErrors,
  type PersistentError,
} from '@/features/message/panel-errors';
export {
  retryMessageSubmission,
  cancelTurn,
  setSessionConfig,
  retrySessionConfigMutation,
  closeChat,
  resolvePermission,
  respondElicitation,
  respondQuestion,
  sendMessage,
  type SessionConfigMutation,
} from '@/features/message/user-actions';
