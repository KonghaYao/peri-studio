# Eclipse Theia 与 OpenVSCode Server 远程 FS / Git 设计研究

> 日期：2026-08-23
>
> 目标：为 `docs/design/remote-fs-git-protocol.md` 提供可核验的一手资料与迁移建议。
>
> 来源限制：只引用 Eclipse Theia、OpenVSCode Server、VS Code 的官方文档、官方仓库和固定提交源码；不引用博客或二手解读。

## 0. 研究基线与判定口径

本文固定到以下提交，避免源码链接随分支漂移：

- Eclipse Theia：[`c66a38110467826d2eb718fccd88eb2692d28969`](https://github.com/eclipse-theia/theia/tree/c66a38110467826d2eb718fccd88eb2692d28969)。
- OpenVSCode Server：[`2bfb814c5215c51a10e80c2cb1b58ed91068ad8b`](https://github.com/gitpod-io/openvscode-server/tree/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b)。
- VS Code 对照基线：[`f3fa55c39d3df2923b46a3d76cf6baf0afa1db33`](https://github.com/microsoft/vscode/tree/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33)。

本文把接口分成三档：

1. **公开契约**：官方文档明确面向采用者，或 VS Code extension API 这类有兼容目标的 API。
2. **可复用源码 seam**：包中导出的 TypeScript interface/DI token，适合定制同一版本应用，但没有独立 wire 兼容承诺。
3. **内部 wire/实现**：连接路径、消息编码、channel 名、握手字段、进程管理与重连状态机；只可借鉴，不应兼容。

核心结论是：Theia 比 OpenVSCode 更适合研究模块 seam；OpenVSCode 更适合验证“完整远程 IDE 如何组合”。两者都没有为第三方 Web 面板发布稳定的 FS/Git 网络协议。

## 1. Eclipse Theia：总体进程与 DI 边界

### 1.1 frontend / backend

Theia 官方架构文档明确把应用拆成 frontend 与 backend 两个进程：frontend 运行浏览器 UI，backend 运行 Node.js；远程部署时 backend 位于远端主机，两者通过 WebSocket 上的 JSON-RPC 或 HTTP REST 通信。两边各有自己的依赖注入容器。[官方 Architecture Overview](https://theia-ide.org/docs/architecture/)

这带来一个很有价值的产品 seam：

```text
browser frontend DI container
        │ typed proxy / event callback
        ▼
backend Node.js DI container
        │ OS API / child process / native watcher
        ▼
workspace filesystem + Git CLI
```

`common` 目录只放不依赖具体 runtime 的契约；`browser` 放 UI 实现；`node` 放 backend 实现。这是官方文档明示的包内分层。[官方 Architecture Overview](https://theia-ide.org/docs/architecture/)

### 1.2 DI 组合方式

Theia extension 是编译期加入应用的 npm 包。extension 通过 Inversify `ContainerModule` 向 frontend/backend 容器绑定 service 与 contribution；应用启动时加载所有模块并形成每侧一个全局容器。[官方 Authoring an Extension](https://theia-ide.org/docs/authoring_extensions/)

Theia 官方还区分四种扩展：

- VS Code extensions：运行时安装，受 VS Code extension API 约束。
- Theia extensions：编译期加入，可通过 DI 访问应用内部能力。
- Theia plugins：VS Code 插件模型加 Theia 特有能力。
- headless plugins：只在 backend 生效，不隶属某个 frontend connection。

官方文档说明 VS Code extensions/Theia plugins 通常“每个 frontend connection 一个独立进程”；Theia extensions 则直接成为应用 frontend/backend 的组成部分。[官方 Extensions](https://theia-ide.org/docs/extensions/)

对 Peri 的含义：可借鉴“同一领域前后端各有 adapter，由 shared contract 连接”，但不应把一个全局 DI 容器或任意 backend service 暴露给浏览器。

### 1.3 稳定性判断

- frontend/backend、Theia extension 与 VS Code extension 的产品级区分属于**公开契约**。
- npm 包导出的 service interface、DI token 属于**源码 seam**；采用者能替换，但升级时仍需编译与回归测试。
- 具体容器绑定顺序、service path 和序列化编码属于**内部实现**。

## 2. Theia RPC proxy、编码与连接

### 2.1 双向 typed proxy

固定源码中的 [`RpcProxyFactory`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/common/messaging/proxy-factory.ts) 用 JavaScript `Proxy` 把方法调用转换为 RPC request；服务端 target 接收调用，client target 可接收反向通知。

同一个连接因此是双向的：

- frontend 可以 `server.stat(...)`。
- backend 可以经 `client.notifyDidChangeFile(...)` 回调 frontend。
- method 以 request/reply 表示；以 `notify` 或 `on` 开头的方法按 notification 发送。
- `onDidOpenConnection` / `onDidCloseConnection` 暴露给本地代理使用。

[`RpcConnectionHandler`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/common/messaging/proxy-factory.ts) 以 path 注册 backend target factory，并在新 channel 到达时创建 proxy 与 target。

这是一种深接口：领域 interface 保留普通 TypeScript 方法，RPC plumbing 集中在一个工厂中。

### 2.2 “JSON-RPC”文档名与实际二进制编码

官方架构文档仍用 JSON-RPC 描述前后端调用，但固定源码的当前 message RPC 实现使用 MessagePack：[`rpc-message-encoder.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/common/message-rpc/rpc-message-encoder.ts) 定义 Request、Notification、Reply、ReplyErr、Cancel，并由 `msgpackr` 编解码。

[`WebSocketChannel`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/common/messaging/web-socket-channel.ts) 在一条主 WebSocket 上复用多个 service channel，并以 `Uint8Array` 读写二进制消息。

因此准确表述应是：

- 编程模型是 JSON-RPC 风格的 request/reply/notification/cancel。
- 当前 wire 是 Theia 自有的 multiplexed binary message RPC，不是可直接拿第三方 JSON-RPC client 调用的公开端点。
- `JsonRpc*` 类型在源码中作为兼容别名保留并标为 deprecated，也说明命名不应被当作 wire 承诺。[`proxy-factory.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/common/messaging/proxy-factory.ts)

### 2.3 连接和 reconnect

[`WebSocketConnectionSource`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/browser/messaging/ws-connection-source.ts) 使用 Socket.IO，配置无限重连，退避从 1 秒到 10 秒。

重连有两种结果：

- backend 接受旧 frontend identity 时，flush 离线缓冲并继续当前逻辑连接。
- backend 不接受时，关闭旧 channel、清空缓冲、重新建立初始连接；产品配置也可选择直接 reload 页面。

[`ConnectionStatusService`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/browser/connection-status-service.ts) 通过 socket open/close、自然消息活动与 ping 将状态归纳为 ONLINE/OFFLINE。

[`SocketWriteBuffer`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/common/messaging/socket-write-buffer.ts) 只为断线窗口保留默认 100 KiB 缓冲；超出即抛错。它不是 durable outbox，也不提供 exactly-once。

对 Peri 的关键启示：transport reconnect 不能等价于 action replay。现有 `commandId + accepted/committed/error + DELIVERY_UNKNOWN` 比 Theia 的普通 RPC 重连更适合有副作用的 Git 操作，应保留。

## 3. Theia filesystem

### 3.1 provider 与 remote server

Theia 的 [`RemoteFileSystemServer`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/filesystem/src/common/remote-file-system-provider.ts) 暴露：

- capabilities、stat、access、fsPath。
- open/read/write/close。
- readFile、writeFile、readFileStream。
- delete、mkdir、readdir、rename、copy、updateFile。
- watch/unwatch。

同文件中的 `RemoteFileSystemProvider` 是 frontend wrapper；`FileSystemProviderServer` 是 backend wrapper。backend 把 provider 的文件事件、capability 变化和 stream data 反向通知 frontend。

[`remote-file-service-contribution.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/filesystem/src/browser/remote-file-service-contribution.ts) 将 remote provider 注册成 frontend 的 `file` scheme。

[`filesystem-backend-module.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/filesystem/src/node/filesystem-backend-module.ts) 则把 `DiskFileSystemProvider` 绑定到 `FileSystemProvider`，并在 `/services/remote-filesystem` 注册 RPC connection handler；连接关闭时 dispose 对应 server。

这是很清晰的三层分解：

```text
FileService
  → frontend RemoteFileSystemProvider
  → RPC RemoteFileSystemServer interface
  → backend FileSystemProviderServer
  → DiskFileSystemProvider
```

但 `/services/remote-filesystem`、method 名、URI 形状和 MessagePack 编码都没有独立协议版本，因此仍属于**内部 wire**。

### 3.2 file watching

[`filesystem-watcher-protocol.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/filesystem/src/common/filesystem-watcher-protocol.ts) 定义 watch/unwatch 与 `onDidFilesChanged` / `onError` callback。

[`FileSystemWatcherServiceDispatcher`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/filesystem/src/node/filesystem-watcher-dispatcher.ts) 根据 client id 把事件路由到正确 frontend。

当前 Node watcher 基于 Parcel watcher；它按 URI 与 client 维护引用，排队处理原生事件，并把 create/delete/update 映射为稳定的文件变更类型。[`parcel-filesystem-service.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/filesystem/src/node/parcel-watcher/parcel-filesystem-service.ts)

`RemoteFileSystemProvider` 还保存 watcher id、URI 和 options；RPC 重新打开后重新申请所有 watcher。[`remote-file-system-provider.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/filesystem/src/common/remote-file-system-provider.ts)

应注意 Theia 的 watcher callback 没有公开的 epoch、单调 seq 或 replay cursor。错误会触发 error callback，但事件本身不是完整事实日志。

这支持 Peri 已有判断：watch 只做 invalidation；重连、overflow 或 gap 后必须重查，而不能盲信事件补齐状态。

### 3.3 binary 与大 payload

Theia RPC 的 MessagePack 能直接编码 `Uint8Array`，避免 base64。[`rpc-message-encoder.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/common/message-rpc/rpc-message-encoder.ts)

远程 FS 同时提供两种读取：

- `readFile`：一次 RPC 返回完整 `Uint8Array`。
- `readFileStream`：backend 以 handle 发送多次 `onFileStreamData`，结束时发送 `onFileStreamEnd`。

`FileSystemProviderServer` 的 fd `read` 使用 64 KiB buffer，而 stream 也沿同一 RPC/channel 反向通知。[`remote-file-system-provider.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/filesystem/src/common/remote-file-system-provider.ts)

源码中没有看到面向该 FS stream 的逐 stream credit、独立 data socket、checksum、可恢复 offset 或 relay hop 背压契约。主 WebSocket 又承载多个 service channel。[`web-socket-channel.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/core/src/common/messaging/web-socket-channel.ts)

所以 Peri 不应照搬此传输：其 `control/data` 双连接、credit、checksum、TTL upload 和逐 hop 有界 relay 对大文件更安全。

## 4. Theia SCM、Git 与插件宿主

### 4.1 SCM 是 UI/domain seam

Theia 的 [`ScmProvider`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/scm/src/browser/scm-provider.ts) 把 repository provider、resource group、resource state、命令和事件组织成 UI 可消费模型。

[`ScmService`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/scm/src/browser/scm-service.ts) 管理多个 repository/provider，而不是把 Git stdout 直接交给 widget。

插件桥的 [`scm-main.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/plugin-ext/src/main/browser/scm-main.ts) 与 [`scm.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/plugin-ext/src/plugin/scm.ts) 在 main/plugin 两侧同步 source control、group、resource state 与 input state。

该桥包含 resource-state splice 语义：插件侧批量计算变化，main 侧将 splice 应用到 SCM group。它适合减少 UI 状态传输，但仍是插件 API 实现细节，不是带 generation 的跨故障状态复制协议。

Peri 可以借鉴“snapshot/group/resource DTO + batch splice”，但必须额外保留 `baseGeneration/newGeneration`；基线不匹配时 reset 全量重查。

### 4.2 Git 的执行位置

Theia 官方应用组合文档明确把 Git 支持作为可加入应用的 VS Code extension 示例，而不是 Theia filesystem RPC 的子命令。[官方 Build your own IDE/Tool](https://theia-ide.org/docs/composing_applications/)

VS Code extension 在 Theia 中运行于专用 plugin host 进程；官方 extension 文档说明它受 VS Code extension API 约束并按 frontend connection 隔离。[官方 Extensions](https://theia-ide.org/docs/extensions/)

固定源码中的 [`HostedPluginProcess`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/plugin-ext/src/hosted/node/hosted-plugin-process.ts) 管理 plugin host 子进程；[`plugin-host-rpc.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/plugin-ext/src/hosted/node/plugin-host-rpc.ts) 和 [`plugin-ext/src/common/rpc-protocol.ts`](https://github.com/eclipse-theia/theia/blob/c66a38110467826d2eb718fccd88eb2692d28969/packages/plugin-ext/src/common/rpc-protocol.ts) 承担 host 与 main 的 RPC。

因此默认思路仍是“Git extension 在 backend 邻近工作区执行 Git，再投影 SCM 状态”，不是浏览器通过公开 Git wire 直接操作仓库。

### 4.3 接口稳定性

- VS Code extension API 兼容范围属于**公开契约**；Theia 官方说明每个版本对应特定 VS Code API 版本，也可能存在 stubbed API。[官方 Installing VS Code Extensions](https://theia-ide.org/docs/user_install_vscode_extensions/)
- `ScmProvider`、Remote FS interface 与 DI token 是**源码 seam**，适合同版本 Theia 产品定制。
- plugin host RPC、SCM splice method、service path 与 MessagePack frame 是**内部实现**。

## 5. OpenVSCode Server：定位与 build

### 5.1 最小 fork，而非独立 IDE framework

OpenVSCode Server 官方 README 将项目定义为“在远端机器运行、由现代浏览器访问的 VS Code”，并说明目标是分享让上游 VS Code 运行于 server 场景所需的最小改动，以保持直接升级路径和低维护成本。[固定提交 README](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/README.md)

官方 scope 也明确：只增加 server 场景必需内容，不打算改变 VS Code 或在该 fork 中添加一般功能；非 server 特有变更应提交上游。[固定提交 README](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/README.md#the-scope-of-this-project)

仓库本身是完整 Code-OSS fork；server build/entrypoint 可从以下固定源码核验：

- [`src/server-main.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/server-main.ts)：Node server bootstrap。
- [`src/vs/server/node/server.main.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/server/node/server.main.ts)：server main 装配。
- [`build/gulpfile.reh.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/build/gulpfile.reh.ts)：remote extension host/server 构建任务。

这使 OpenVSCode 很适合做端到端行为基准，但不适合直接抽取一个小而稳定的资源服务 SDK。

### 5.2 remote agent 与 extension host

[`remoteExtensionHostAgentServer.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/server/node/remoteExtensionHostAgentServer.ts) 接收并分类远程连接、注册管理通道、创建 extension host 连接并管理断线/重连生命周期。

[`extensionHostConnection.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/server/node/extensionHostConnection.ts) 管理 extension host 进程与连接。

[`remoteAgentConnection.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/platform/remote/common/remoteAgentConnection.ts) 定义客户端侧 remote agent 连接、channel 获取和管理连接抽象。

管理连接与 extension host 连接应理解为内部 transport topology：它们共同实现完整工作台，而不是公开给第三方的 service protocol。

### 5.3 remoteFilesystem channel

工作台侧 [`RemoteFileSystemProviderClient`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/workbench/services/remote/common/remoteFileSystemProviderClient.ts) 从 remote agent connection 取得名为 `remoteFilesystem` 的 channel，并注册 `vscode-remote` provider。

server 侧 [`RemoteAgentFileSystemProviderChannel`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/server/node/remoteFileSystemProviderServer.ts) 将 channel 调用转交 server 文件服务。

这与固定 VS Code 对照源码的结构一致：

- [VS Code client](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vs/workbench/services/remote/common/remoteFileSystemProviderClient.ts)
- [VS Code server](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vs/server/node/remoteFileSystemProviderServer.ts)

`remoteFilesystem` 的价值在“复用统一文件服务/provider”，不在 channel wire。其 command 名、IPC 编码、握手、URI scheme 和 server version 都是内部实现。

### 5.4 management connection 与 reconnect

OpenVSCode/Code-OSS remote agent 用 management connection 承载多个 channel；extension host 使用单独连接/进程。server 按 connection type 走不同初始化路径，并用 connection token/reconnection token 管理会话。[`remoteExtensionHostAgentServer.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/server/node/remoteExtensionHostAgentServer.ts)

这套 topology 的目标是恢复完整 VS Code remote session，不代表其中 mutation 具有业务 exactly-once，也不提供 Peri 所需的 `accepted/committed/DELIVERY_UNKNOWN` 语义。

值得迁移的是：

- control 与 extension host/process 生命周期分离。
- 连接以 token 和 session identity 绑定。
- channel 在一条管理连接上复用。

不值得迁移的是：

- 直接兼容 management handshake 或 reconnection token 格式。
- 假设 transport reconnect 后所有旧请求都能安全重放。

### 5.5 auth 与 bootstrap 边界

OpenVSCode README 公开的部署参数包括：

- `--host` 与 `--port`。
- `--connection-token`。
- `--connection-token-file`。
- `--without-connection-token`。

README 明确说明无 token 时只要知道 hostname/port 即可访问 IDE；连接 token 是其内置的基础访问保护。[固定提交 README：Securing access](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/README.md#securing-access-to-your-ide)

这不是多租户资源授权模型。它没有替代 Peri 的 principal → project/workspace authorization、instance fencing、审计、配额或按 operation 授权。

部署时 OpenVSCode 通常拥有其工作区 OS 用户可访问的全部文件和进程能力；README 的 Docker 示例也直接把宿主目录挂载到容器工作区。[固定提交 README：Docker](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/README.md#getting-started)

因此不能把 OpenVSCode connection token 当作 Peri workspace capability token，也不能让浏览器把绝对路径传给 agent。

## 6. OpenVSCode 的 SCM/Git 执行位置

OpenVSCode 保留 Code-OSS 内置 Git extension：[`extensions/git`](https://github.com/gitpod-io/openvscode-server/tree/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/extensions/git)。

其 [`git.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/extensions/git/src/git.ts) 调用 Git CLI 并解析结果；[`repository.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/extensions/git/src/repository.ts) 将 status/diff/stage/commit/branch 等组织为 repository 操作。

浏览器工作台通过 extension host SCM bridge 接收 group/resource state：

- [`extHostSCM.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/workbench/api/common/extHostSCM.ts)
- [`mainThreadSCM.ts`](https://github.com/gitpod-io/openvscode-server/blob/2bfb814c5215c51a10e80c2cb1b58ed91068ad8b/src/vs/workbench/api/browser/mainThreadSCM.ts)

由于 workspace extension host 和 Git CLI 位于 server/remote 环境附近，Git 仓库操作在 server 侧执行；SCM UI 只接收结构化状态和命令。这不是另一个公开的 remote Git wire。

对 Peri 的结论不变：目标 instance spawn 固定 Git argv，输出解析为稳定 DTO；Web 面板不能提交 shell、任意 argv、环境变量或凭据。

## 7. 公开接口与内部实现矩阵

| 项目 | 机制 | 分类 | Peri 使用方式 |
| --- | --- | --- | --- |
| Theia frontend/backend 架构 | 官方架构文档 | 公开契约 | 借鉴进程边界 |
| Theia extension DI | ContainerModule、service/contribution | 公开扩展机制 + 源码 seam | 借鉴模块组合，不暴露容器 |
| VS Code extension API in Theia | 按 Theia 版本声明兼容范围 | 公开契约 | 可参考 SCM/FS provider 行为 |
| Theia `RemoteFileSystemServer` | TypeScript interface | 源码 seam | 参考 operation 集合 |
| Theia `/services/remote-filesystem` | path + MessagePack RPC | 内部 wire | 拒绝兼容 |
| Theia watcher client id / callback | backend routing | 内部实现 | 借鉴订阅清理，补 epoch/seq |
| Theia SCM provider | group/resource UI model | 源码 seam | 借鉴 DTO 与 batch splice |
| Theia plugin-host RPC | per-frontend process bridge | 内部实现 | 借鉴隔离，不兼容消息 |
| OpenVSCode server product | 完整浏览器 IDE | 公开部署产品 | 端到端行为对照 |
| OpenVSCode connection-token CLI | 基础访问保护 | 公开部署参数 | 不替代 Peri authz |
| `remoteFilesystem` channel | VS Code/OpenVSCode 内部 IPC | 内部 wire | 只参考 provider seam |
| management/extension-host connection | remote agent topology | 内部实现 | 借鉴生命周期分离 |
| 内置 Git extension | server 侧 Git CLI + SCM bridge | 开源实现 | 借鉴执行位置与 DTO |

## 8. 对 Peri 现有设计的具体迁移建议

### 8.1 直接接受并强化

1. **保留 `RemoteFileSystem` 与 `Repository` 两个深模块。** Theia/VS Code 都把文件 provider 与 SCM provider 分开；Git 不是 FS method。
2. **保留 instance 就近执行。** Theia backend 和 OpenVSCode remote extension host 都把 OS/Git 工作放在 workspace 附近。
3. **保留 provider 语义，不兼容内部 wire。** operation 集可参考 Theia `RemoteFileSystemServer` 和 VS Code provider，但 Peri 自己做 version/capability/error。
4. **保留 watcher 仅作 invalidation。** Theia 会在重连后重新注册 watcher，却没有可依赖的事件日志；Peri 的 epoch/seq/reset 更稳妥。
5. **保留 SCM snapshot/group/resource DTO。** 可新增批量 splice，但必须绑定 `baseGeneration/newGeneration`。
6. **保留 Git CLI adapter。** OpenVSCode 和 VS Code 内置 Git extension 证明这条路径成熟；不得暴露 raw stdout/argv。
7. **保留有副作用 action 的 no-redelivery barrier。** 普通 RPC reconnect 不足以处理 commit/push 的投递不确定性。
8. **保留 control/data 分离和 credit。** Theia 的单主连接 + callback stream 不足以证明跨两跳 relay 的背压安全。

### 8.2 建议新增或写得更明确

1. 在 `ResourceTransport` 明确“frontend-facing contract”与“instance adapter contract”是两套类型，可共享领域 DTO，但不能共享可信字段。
2. 为每个 subscription 增加 `resumePolicy: "resubscribe-and-reset"`；第一版不要承诺事件 replay。
3. 在能力协商中区分 `fs.readWhole`、`fs.readRange`、`fs.readStream`，避免像 Theia 一样由同一接口暗含不同内存风险。
4. 为 SCM 增加可选 `git/resource-splice`，字段至少含 `repoId/baseGeneration/newGeneration/groupId/splices`。
5. 对 splice 设条目数与总字节上限；超过直接 `git/invalidated`，不要把全量状态伪装成巨型增量。
6. 将 `connectionGeneration` 写入 stream、watch 和 action 路由表；旧 generation 的 callback 一律丢弃。
7. 为 instance `ResourceHost` 定义独立 process/service boundary；即使首版同进程，也不要让 ACP handler 直接拿 FS/Git implementation。
8. 在认证章节明确：transport ticket 只绑定一条连接，不等于 workspace operation authorization。
9. 把 `GitChange.status` 的封闭 enum 与 UI group mapping 独立，避免未来支持其他 SCM 时泄漏 Git porcelain。
10. 为 Git extension-like 后台刷新设置 per-repo debounce、single-flight 与结果 generation fence。

### 8.3 明确拒绝迁移

- 不复制 Theia `/services/remote-filesystem`、RPC method 命名或 MessagePack frame。
- 不复制 OpenVSCode `remoteFilesystem` channel、management handshake 或 reconnection token。
- 不把 Socket.IO 自动重连、100 KiB 离线 buffer 或任意 transport queue 当作 durable outbox。
- 不在同一控制 socket 上无界发送文件、diff、SCM 全量状态与 ACP/Yjs 消息。
- 不把 `readFile(): Uint8Array` 当成大文件 API；只能用于显式小文件 fast path。
- 不把 watcher callback 当作有序、无丢失、可 replay 的变更日志。
- 不把 SCM splice 当作没有基线的最终事实。
- 不把 OpenVSCode connection token 当作多租户鉴权和 workspace 授权。
- 不让 browser 选择 remote URI scheme、absolute path、repo path、Git argv 或 extension host environment。
- 不把完整 OpenVSCode Server 嵌入 Peri instance 仅为了 FS/Git；它的权限面、资源占用和升级耦合远大于所需 seam。

## 9. 风险清单

| 风险 | 来自研究的证据 | Peri 对策 |
| --- | --- | --- |
| 内部协议漂移 | Theia RPC 编码已从“JSON-RPC”命名演进到 MessagePack；OpenVSCode 跟随 VS Code fork | 自有版本化协议与 golden tests |
| reconnect 误重放 | Theia 自动重连/flush 不等于业务 exactly-once | mutation no-redelivery + 对账 |
| watcher 丢失 | Theia 提供 error/重新注册，而非 replay log | epoch/seq/reset + snapshot |
| 大文件阻塞 | Theia service multiplex + callback stream 无 Peri 两跳 credit 契约 | 独立 data WS + hop-by-hop credit |
| SCM 增量错基线 | plugin bridge 的 splice 面向同一 session UI | generation-fenced splice |
| Git hook/凭据风险 | Git 在 workspace backend/extension host 执行 | 固定 argv、credential broker、审计 |
| 权限面过宽 | OpenVSCode server 持有工作区 OS 能力；token 只保护入口 | workspace grant + anchored path + per-op authz |
| 多前端资源泄漏 | Theia watcher/plugin host 按 frontend connection 管理 | principal/connection generation 清理 |
| 版本组合爆炸 | Theia VS Code API 兼容范围按版本变化；OpenVSCode 跟随上游 | capability negotiation + compatibility matrix |
| 内存放大 | whole-file RPC 和 SCM 全量状态可一次分配 | inline 阈值、分页、stream、硬限额 |

## 10. 最终判断

Theia 最值得 Peri 借鉴的是：frontend/backend 双容器、shared typed interface、per-connection backend service、remote provider、watch 重建、SCM group/resource seam 和插件进程隔离。

OpenVSCode Server 最值得借鉴的是：保持 Code-OSS 最小 fork、management 与 extension-host 生命周期分离、远端 provider 就近访问文件系统、Git extension 在远端执行 Git CLI，再把结构化 SCM 状态送回工作台。

两者共同证明了 Peri 当前总体方向正确：

```text
Web UI state
   ≠ filesystem truth
   ≠ Git process

Web UI
  → stable Peri DTO/protocol
  → authorized workspace route
  → instance-owned FS/Git adapter
  → OS filesystem / Git CLI
```

需要坚持的差异是：Peri 是跨 server relay、跨租户授权、与 ACP/Yjs 并存的资源协议，不是完整 IDE 的内部 IPC。因此必须比 Theia/OpenVSCode 内部 channel 更明确地定义版本、generation、背压、投递不确定性、安全路径和故障恢复。
