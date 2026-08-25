# 8.2.1 Channel 是 SDK 抽象，不是 MCP primitive

[文档库首页](index.md) · [上一篇：MCP Channel](mcp-channel.md) · [下一篇：MCP Extension](mcp-extensions.md)

运行时、订阅、事务、授权与恢复语义见 [MCP Channel](mcp-channel.md)。


为避免每个 Server 重复管理 Resource、订阅者、背压和投递竞态，宣称实现 **MCPP Server SDK Profile** 的 SDK **MUST** 提供以下服务端应用层抽象。未使用 MCPP SDK 的裸 MCP Server 不强制采用这些类型名称，但其行为若宣称兼容 MCPP Channel，MUST 满足 [MCP Channel](mcp-channel.md) 与 [S16–S21](conformance.md) 的等价语义：

| 抽象 | 职责 | 标准 MCP 映射 |
| --- | --- | --- |
| `ChannelManager` | 注册 Channel、路由 Resource 与 Tool、接入订阅 sink、执行授权过滤、管理背压与生命周期 | `resources/*` + `subscriptions/listen` + `tools/*` |
| `Channel<TOutbound, TInbound, TResult>` | 一个具名、强类型的单向或双向通道；拥有稳定身份、方向、schema、存储、保留策略与 Resource / Tool binding | 出站映射为 Resource；入站映射为 Tool |
| `ChannelStore<TOutbound, TInbound, TResult>` | 保存出站状态/事件与入站命令结果，提供原子写入、幂等去重、游标读取与保留边界 | `resources/read` 的事实源与 `tools/call` 的幂等存储 |
| `SubscriptionRouter` | 维护活动 `subscriptionId → filter + authorization context + sink`，只向有权且已订阅的 sink 发更新信号 | `notifications/subscriptions/acknowledged` 后的 `notifications/resources/updated` |
| `Channel.send` / `ChannelManager.send` | Server 向 Client 方向提交状态或事件，提交成功后通知符合条件的订阅者 | 先更新 Resource，后发标准 updated notification |
| `Channel.receive` / `ChannelManager.receive` | 注册 Client 向 Server 方向的强类型处理器；由 Manager 在入站 Tool 被调用时执行 | 标准 `tools/list` / `tools/call`，不是自定义 protocol method |

这些名称是 MCPP SDK 契约，不得出现在 MCP capability 或 JSON-RPC `method` 中。MCP Client 不需要知道 Server 内部存在 `ChannelManager`。

以下接口全部使用 **TypeScript 风格伪代码**；它描述跨语言 SDK 契约，不要求实现直接复制这些类型。

```ts
type ChannelId = string;
type EventId = string;
type CommandId = string;
type JsonSchema202012<T = unknown> = Readonly<Record<string, unknown>>;

type ChannelDirection =
  | "server-to-client"
  | "client-to-server"
  | "duplex";

type ChannelMode = "state" | "event-log";
type Durability = "durable" | "process-local";

interface RetentionPolicy {
  maxEvents?: number;
  maxAgeMs?: number;
  maxBytes?: number;
}

interface InboundRetentionPolicy {
  maxCommands: number;
  maxAgeMs: number;
  maxBytes?: number;
}

interface ChannelToolAnnotations {
  // 字段名与标准 MCP Tool annotations 一致。
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

type Audience =
  | { kind: "all-authorized" }
  | { kind: "principals"; principals: readonly string[] }
  | { kind: "topic"; topic: string };

interface DeliveryScope {
  tenant: string;
  audience: Audience;
}

interface AuthorizationContext {
  // 全部由 Server / transport 建立；不得从 Tool arguments 复制。
  opaqueId: string;
  tenant: string;
  principal: string;
}

interface SendReceipt {
  eventId: EventId;
  sequence?: number;
  resourceVersion: string;
  committedAt: string;
  deduplicated: boolean;
  subscribersMatched: number;
  notificationsEnqueued: number;
  subscriptionsLagged: number;
}

type SendOutcome =
  | { status: "committed"; receipt: SendReceipt }
  | { status: "committed-with-delivery-gaps"; receipt: SendReceipt };

type ReceiveOutcome<TResult> =
  | { status: "completed"; result: TResult; deduplicated: boolean }
  | { status: "accepted"; operationId: string; deduplicated: boolean }
  | {
      status: "failed";
      safeErrorCode: string;
      deduplicated: boolean;
    }
  | { status: "in-progress"; operationId?: string; deduplicated: true }
  | {
      status: "delivery-unknown";
      safeErrorCode: string;
      deduplicated: boolean;
    };

interface OutboundAuthorizer<TOutbound> {
  canPublish(input: {
    auth: AuthorizationContext;
    scope: DeliveryScope;
    event: TOutbound;
  }): Promise<boolean>;

  canSubscribe(input: {
    auth: AuthorizationContext;
    resourceUri: string;
  }): Promise<boolean>;

  canRead(input: {
    auth: AuthorizationContext;
    resourceUri: string;
  }): Promise<boolean>;
}

interface InboundAuthorizer<TInbound> {
  canReceive(input: {
    auth: AuthorizationContext;
    command: InboundMessage<TInbound>;
  }): Promise<boolean>;
}

type ChannelAuthorizer<TOutbound, TInbound> =
  ([TOutbound] extends [never]
    ? Record<never, never>
    : OutboundAuthorizer<TOutbound>)
  & ([TInbound] extends [never]
      ? Record<never, never>
      : InboundAuthorizer<TInbound>);

interface OutboundCommit {
  eventId: EventId;
  sequence?: number;
  resourceVersion: string;
  committedAt: string;
  deduplicated: boolean;
}

interface OutboundEvent<TOutbound> {
  eventId: EventId;
  sequence: number;
  occurredAt: string;
  correlationId?: string;
  causationId?: string;
  payload: TOutbound;
}

type OutboundSnapshot<TOutbound> =
  | {
      mode: "state";
      schemaVersion: string;
      resourceVersion: string;
      lastEventId?: EventId;
      updatedAt?: string;
      state: TOutbound | null;
    }
  | {
      mode: "event-log";
      schemaVersion: string;
      headSequence: number;
      truncatedBefore: number;
      events: readonly OutboundEvent<TOutbound>[];
    };

type InboundReservation<TResult> =
  | { state: "reserved"; reservationId: string }
  | { state: "completed"; outcome: ReceiveOutcome<TResult> }
  | { state: "in-progress"; operationId?: string }
  | { state: "delivery-unknown"; safeErrorCode: string };

interface OutboundStore<TOutbound> {
  commitOutbound(input: {
    scope: DeliveryScope;
    eventId: EventId;
    event: TOutbound;
    correlationId?: string;
    causationId?: string;
  }): Promise<OutboundCommit>;

  readOutbound(input: {
    auth: AuthorizationContext;
    afterSequence?: number;
    limit: number;
  }): Promise<OutboundSnapshot<TOutbound>>;
}

interface InboundStore<TResult> {
  // reserveInbound 必须按 channel + authorization context + commandId 幂等。
  reserveInbound(input: {
    auth: AuthorizationContext;
    commandId: CommandId;
    requestDigest: string;
  }): Promise<InboundReservation<TResult>>;

  completeInbound(input: {
    reservationId: string;
    result: ReceiveHandlerResult<TResult>;
  }): Promise<void>;

  markInboundDeliveryUnknown(input: {
    reservationId: string;
    safeErrorCode: string;
  }): Promise<void>;
}

type ChannelStore<TOutbound, TInbound, TResult> =
  ([TOutbound] extends [never]
    ? Record<never, never>
    : OutboundStore<TOutbound>)
  & ([TInbound] extends [never]
      ? Record<never, never>
      : InboundStore<TResult>);

interface ChannelBaseSpec {
  // 稳定身份。id 在单个 Server 内唯一；版本升级不得改变其业务含义。
  id: ChannelId;
  title: string;
  description: string;
  schemaVersion: string;
  observability: {
    metrics: boolean;
    audit: "off" | "metadata-only";
  };
}

// Server → Client：映射为可读、可订阅的 MCP Resource。
interface OutboundBinding<TOutbound> {
  resourceUri: string;
  mimeType: "application/json";
  mode: ChannelMode;
  schema: JsonSchema202012<TOutbound>;
  durability: Durability;
  retention: RetentionPolicy;
  maxPayloadBytes: number;
  subscriberQueueCapacity: number;
  enqueueTimeoutMs: number;
  overflow: "disconnect-lagged";
}

// Client → Server：映射为 tools/list 中的一个标准 MCP Tool。
interface InboundBinding<TInbound, TResult> {
  toolName: string;
  toolTitle?: string;
  toolDescription: string;
  messageSchema: JsonSchema202012<TInbound>;
  resultSchema: JsonSchema202012<TResult>;
  resultMode: "synchronous" | "accept-async";
  annotations: ChannelToolAnnotations;
  maxPayloadBytes: number;
  maxResultBytes: number;
  timeoutMs: number;
  queueCapacity: number;
  enqueueTimeoutMs: number;
  overflow: "reject-before-start";
  maxConcurrency: number;
  durability: Durability;
  retention: InboundRetentionPolicy;
}

type ChannelSpec<TOutbound, TInbound, TResult> = ChannelBaseSpec &
  ([TOutbound] extends [never]
    ? {
        direction: "client-to-server";
        outbound?: never;
        inbound: InboundBinding<TInbound, TResult>;
      }
    : [TInbound] extends [never]
      ? {
          direction: "server-to-client";
          outbound: OutboundBinding<TOutbound>;
          inbound?: never;
        }
      : {
          direction: "duplex";
          outbound: OutboundBinding<TOutbound>;
          inbound: InboundBinding<TInbound, TResult>;
        });

interface ChannelRuntime<TOutbound, TInbound, TResult> {
  store: ChannelStore<TOutbound, TInbound, TResult>;
  authorize: ChannelAuthorizer<TOutbound, TInbound>;
}

interface SendOptions {
  // 必须来自当前可信 Server 执行上下文；service principal 也应显式建模。
  publisher: AuthorizationContext;
  eventId: EventId;
  correlationId?: string;
  causationId?: string;
  notifyOnDeduplicated?: boolean;
}

interface ReplyOptions {
  eventId: EventId;
  correlationId?: string;
  causationId?: string;
  notifyOnDeduplicated?: boolean;
  // 缺省时仅回复当前已认证 principal；显式扩大范围必须重新授权。
  scope?: DeliveryScope;
}

interface InboundMessage<TInbound> {
  // Client 重试同一业务动作时必须复用。
  commandId: CommandId;
  message: TInbound;
  correlationId?: string;
  replyToEventId?: EventId;
}

interface ReceiveBaseContext {
  channelId: ChannelId;
  requestId: string;
  // Server / transport 建立的 opaque 授权域标识，不是 token，也不由 Client 提供。
  authorizationContext: string;
  tenant: string;
  principal: string;
  receivedAt: string;
  signal: AbortSignal;
}

type ReceiveContext<TOutbound> = ReceiveBaseContext &
  ([TOutbound] extends [never]
    ? Record<never, never>
    : {
        // reply() 不是 tools/call response；它走同一 Channel 的 send() 出站路径。
        reply(
          message: TOutbound,
          options: ReplyOptions,
        ): Promise<SendOutcome>;
      });

type ReceiveHandlerResult<TResult> =
  | { status: "completed"; result: TResult }
  | { status: "accepted"; operationId: string }
  | { status: "failed"; safeErrorCode: string };

// Manager 把 ReceiveHandlerResult 转换为可幂等缓存的 ReceiveOutcome，
// 再编码成标准 CallToolResult / structuredContent。
type ReceiveHandler<TOutbound, TInbound, TResult> = (
  input: InboundMessage<TInbound>,
  context: ReceiveContext<TOutbound>,
) => Promise<ReceiveHandlerResult<TResult>>;

interface ReceiveRegistration {
  close(): Promise<void>;
}

interface ChannelIdentity<TOutbound, TInbound, TResult> {
  readonly id: ChannelId;
  readonly uri?: string;
  readonly direction: ChannelDirection;
  readonly spec: Readonly<ChannelSpec<TOutbound, TInbound, TResult>>;
}

interface OutboundChannel<TOutbound> {
  send(
    scope: DeliveryScope,
    event: TOutbound,
    options: SendOptions,
  ): Promise<SendOutcome>;
}

interface InboundChannel<TOutbound, TInbound, TResult> {
  // 注册唯一入站处理器。仅 client-to-server / duplex Channel 具有该方法。
  receive(
    handler: ReceiveHandler<TOutbound, TInbound, TResult>,
  ): ReceiveRegistration;
}

type Channel<
  TOutbound = never,
  TInbound = never,
  TResult = void,
> = ChannelIdentity<TOutbound, TInbound, TResult>
  & ([TOutbound] extends [never]
      ? Record<never, never>
      : OutboundChannel<TOutbound>)
  & ([TInbound] extends [never]
      ? Record<never, never>
      : InboundChannel<TOutbound, TInbound, TResult>);

interface ChannelManager {
  register<TOutbound = never, TInbound = never, TResult = void>(
    spec: ChannelSpec<TOutbound, TInbound, TResult>,
    runtime: ChannelRuntime<TOutbound, TInbound, TResult>,
  ): Channel<TOutbound, TInbound, TResult>;

  channel<TOutbound = never, TInbound = never, TResult = void>(
    id: ChannelId,
  ): Channel<TOutbound, TInbound, TResult>;

  send<TOutbound>(
    channel: OutboundChannel<TOutbound>,
    scope: DeliveryScope,
    event: TOutbound,
    options: SendOptions,
  ): Promise<SendOutcome>;

  receive<TOutbound, TInbound, TResult>(
    channel: InboundChannel<TOutbound, TInbound, TResult>,
    handler: ReceiveHandler<TOutbound, TInbound, TResult>,
  ): ReceiveRegistration;

  unregister(id: ChannelId): Promise<void>;
  close(): Promise<void>;
}
```

`ChannelSpec` 的必要信息必须满足以下不变量：

- `id`、`title`、`description`、`schemaVersion`、`direction` 与 `observability` 必填；`id` 是 Server 内稳定身份，不是 tenant、principal 或 connection ID；
- `server-to-client` 必须配置 `outbound`，不得配置 `inbound`；`client-to-server` 必须配置 `inbound`，不得配置 `outbound`；`duplex` 必须同时配置二者；SDK 应通过判别联合与条件类型让错误方向的 `send()` / `receive()` 在类型层不可用，并在运行时再次拒绝；
- `outbound.resourceUri` 在同一 Server 内唯一且稳定；`inbound.toolName` 在该 Server 的 Tool namespace 内唯一、符合 MCP Tool 命名规则，并出现在 `tools/list`；
- 相关 schema 均为 JSON Schema 2020-12：`outbound.schema` 校验出站 payload，`inbound.messageSchema` 校验入站 `message`，`inbound.resultSchema` 校验 handler 完成结果；Resource 内容以 UTF-8 JSON 编码，`eventId` / `commandId` 幂等 digest 必须使用 SDK 规定的确定性规范化方式，不能依赖对象键的偶然顺序；
- `inbound.resultMode: "synchronous"` 只允许 handler 返回 `completed`；`"accept-async"` 同时允许 `accepted + operationId`。`annotations` 直接映射为 MCP Tool annotations，供 Host 审批和展示；annotations 是行为提示，不替代 Server 授权与幂等；
- `description` / `toolDescription` 必须写清适用场景、权限与副作用，但不得含 token、PII 或动态用户数据；
- `maxPayloadBytes`、`maxResultBytes`、`timeoutMs`、`maxConcurrency`、出入站队列容量、enqueue timeout 与出入站 retention 必须是有限值；SDK 必须拒绝零容量、无界并发、无界 retention 或不完整的方向配置；
- `ChannelRuntime.authorize` 和 transport 的 authorization context 是权限事实；Client 输入中的 `tenant`、`principal`、topic、room 或 metadata 绝不是身份凭证；
- `observability.audit: "metadata-only"` 只能记录 Channel ID、结果分类、大小、时延和不透明 correlation，不得记录 token、principal 明文、payload、Tool arguments 或敏感 URI query。

`Channel<TOutbound, TInbound, TResult>` 的类型参数固定表示：

```text
TOutbound  Server 经 send() 发布、Client 经 Resource 读取的消息
TInbound   Client 经绑定 Tool 发送、Server 经 receive() 接收的消息
TResult    receive handler 通过 tools/call 返回的业务结果
```
