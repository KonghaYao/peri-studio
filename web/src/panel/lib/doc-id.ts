/** 浏览器可接收的 server-authoritative Y.Doc 标识。 */
export const DOC_REGISTRY = 'hub:registry';

/**
 * 与 Rust DocId 字符集保持一致，同时把 hub 前缀收窄到唯一已知注册表。
 * resource 文档仍须在资源协议边界额外校验 viewId 绑定与租约所有权。
 */
export const isServerDocId = (value: unknown): value is string => value === DOC_REGISTRY
  || (typeof value === 'string' && /^(?:chat|session|resource):[A-Za-z0-9._-]+$/.test(value));
