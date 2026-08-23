# VS Code Remote FS / Git 界面通信协议研究附录

> 研究口径：本文只讨论公开 API、可核验的 VS Code 源码事实，以及可作为实现参考的开源项目。
> VS Code 源码链接固定到提交 `f3fa55c39d3df2923b46a3d76cf6baf0afa1db33`，避免随主分支漂移。
> 本文不是对 VS Code 私有远程服务协议的兼容性声明，也不建议复制未承诺稳定的内部协议。

## 1. 结论摘要

1. VS Code 客户端主体（Code - OSS）公开源码，但 Microsoft 发布版及 Remote Development 服务端并不能简单等同为一套完整开源远程产品。
2. 扩展作者可依赖的文件系统契约是公开的 `FileSystemProvider` API。
3. VS Code 自身的远程工作区实现还存在内部 `remoteFilesystem` channel，用于客户端工作台与远端文件服务之间通信。
4. 这个 channel 是实现细节，不是扩展 API，也不是官方承诺稳定的网络协议。
5. SCM UI 有公开扩展 API，但内置 Git 扩展通常在扩展宿主所在环境调用 Git 可执行文件。
6. 因而 VS Code Remote 并不存在一条可直接复用、独立公开且稳定的“远程 Git wire protocol”。
7. 设计自有协议时，应将 FS、文件事件、Git/SCM 领域命令和长任务传输分层，而不是照搬内部 RPC。
8. 若希望直接研究可部署的完整实现，可优先比较 OpenVSCode Server、code-server 与 Eclipse Theia。

## 2. 开源与专有边界

VS Code 的上游仓库公开了编辑器主体、工作台、扩展宿主、内置 Git 扩展和大量远程相关 client/server 代码，但产品边界不是“所有 Remote Development 均开源”。

- 官方仓库：[microsoft/vscode](https://github.com/microsoft/vscode)
- 固定提交：[f3fa55c39d3df2923b46a3d76cf6baf0afa1db33](https://github.com/microsoft/vscode/tree/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33)
- Code - OSS 许可证：[MIT LICENSE.txt](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/LICENSE.txt)
- Code - OSS 与 Microsoft 发行版的区别：[Visual Studio Code FAQ](https://code.visualstudio.com/docs/supporting/faq#_what-is-the-difference-between-the-vscode-repository-and-the-microsoft-visual-studio-code-distribution)
- Remote Development 扩展/组件的开源状态：[Remote Development FAQ](https://code.visualstudio.com/docs/remote/faq#_why-arent-the-remote-development-extensions-or-their-components-open-source)
- VS Code Server 独立复用限制：[Remote Development FAQ](https://code.visualstudio.com/docs/remote/faq#_can-vs-code-server-be-installed-or-used-on-its-own)
- 远程开发总览：[VS Code Remote Development](https://code.visualstudio.com/docs/remote/remote-overview)

需要区分三个概念：

- `Code - OSS`：GitHub 仓库中的源码工程。
- `Visual Studio Code`：Microsoft 构建、品牌化并分发的产品。
- VS Code Server / Remote Development 组件：支撑官方远程体验的产品组件与分发形态。

因此，“VS Code 仓库里能看到远程客户端实现”不等于“官方远程服务端是一个可直接拿来二次开发的独立开源项目”。

官方边界可以直接概括为：

- `microsoft/vscode`（Code - OSS）源码采用 MIT 许可证。
- Microsoft Visual Studio Code 发行版包含 Microsoft 定制与产品许可部分，不能与 Code - OSS 仓库等同。
- Remote - SSH、WSL、Dev Containers 及其相关组件目前明确不是开源项目。
- 官方 VS Code Server 由 VS Code 客户端管理，不面向其他客户端独立安装或使用，也不能据此假定可重新打包成自有公共服务。

协议设计时可以参考其边界、类型和调用路径，但应自行定义稳定性、版本协商、鉴权和错误语义。

## 3. 公开的 FileSystemProvider 契约

扩展侧正式公开的抽象是 [`vscode.FileSystemProvider`](https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider)。

固定源码中的类型声明可见：

- [`FileSystemProvider`](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vscode-dts/vscode.d.ts)
- [`workspace.registerFileSystemProvider`](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vscode-dts/vscode.d.ts)

这个 API 以 URI scheme 为路由入口。

典型操作集合包括：

- `stat(uri)`：读取文件类型、大小和时间戳。
- `readDirectory(uri)`：列举目录项。
- `createDirectory(uri)`：创建目录。
- `readFile(uri)`：读取完整文件内容。
- `writeFile(uri, content, options)`：写入完整文件内容。
- `delete(uri, options)`：删除文件或目录。
- `rename(oldUri, newUri, options)`：重命名或移动。
- `copy(source, destination, options)`：可选复制能力。
- `watch(uri, options)`：声明观察范围并返回可释放对象。
- `onDidChangeFile`：向工作台推送文件变更事件。

它适合做“能力模型”的参考，但不是网络帧格式。

尤其要注意：

- `readFile` / `writeFile` 的公开接口以完整 `Uint8Array` 为单位，不代表远程传输必须整块缓冲。
- `watch` 和 `onDidChangeFile` 是逻辑订阅，不规定底层使用轮询、操作系统 watcher 还是消息推送。
- 错误通过 `FileSystemError` 表达，但跨网络时仍需定义稳定的错误码和可重试属性。
- URI scheme、authority、path 的规范化必须由实现明确约束。
- 大文件、随机读写、流式上传和断点续传需要自有协议扩展。

建议把公开 API 看成前端适配层：

```text
VS Code / Monaco UI
        │ FileSystemProvider
        ▼
本地适配器（URI、缓存、事件合并）
        │ 自有版本化协议
        ▼
远端 FS 服务（权限、文件锁、watch、流传输）
```

## 4. 内部 remoteFilesystem channel

VS Code 工作台的远程文件系统客户端会从远程连接取得名为 `remoteFilesystem` 的 channel。

固定源码入口：

- [RemoteFileSystemProviderClient](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vs/workbench/services/remote/common/remoteFileSystemProviderClient.ts)
- [RemoteAgentFileSystemProviderChannel](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vs/server/node/remoteFileSystemProviderServer.ts)
- [远程连接相关 IPC 抽象](https://github.com/microsoft/vscode/tree/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vs/platform/remote)

从架构上，它承担以下桥接作用：

- 客户端把远程 URI 的文件操作转为 channel 请求。
- 服务端把请求转交给远端进程中的文件服务。
- 文件变化通过订阅事件返回客户端。
- VS Code 内部 RPC 层负责请求、响应、事件与连接生命周期。

但不能把这个名字误解为公开协议规范。

其限制是：

- 类型位于 VS Code 内部模块，而非 `vscode.d.ts` 的扩展 API。
- 命令名、参数编码、序列化方式和连接握手可随内部重构变化。
- 它依赖 VS Code 自己的 remote agent、IPC 和服务注册体系。
- 官方文档没有承诺第三方客户端与服务端之间的兼容窗口。

所以可借鉴的是职责划分，不应把内部 channel 当成长期兼容目标。

## 5. SCM 与 Git 的真实边界

VS Code 对扩展公开了 Source Control API：

- [Source Control API 指南](https://code.visualstudio.com/api/extension-guides/scm-provider)
- [公开 SCM 类型声明](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vscode-dts/vscode.d.ts)

工作台与扩展宿主之间的 SCM 桥接代码可见：

- [extHostSCM.ts](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vs/workbench/api/common/extHostSCM.ts)
- [mainThreadSCM.ts](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/src/vs/workbench/api/browser/mainThreadSCM.ts)

内置 Git 扩展本身也在仓库中：

- [extensions/git](https://github.com/microsoft/vscode/tree/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/extensions/git)
- [Git 命令执行实现](https://github.com/microsoft/vscode/blob/f3fa55c39d3df2923b46a3d76cf6baf0afa1db33/extensions/git/src/git.ts)

关键事实是：SCM UI 协议与 Git 仓库操作不是同一层。

SCM 桥接主要同步：

- source control、resource group 和 resource state。
- 文件状态、装饰、命令、输入框与选中状态。
- 用户在 SCM 视图触发的动作。

Git 扩展则在其运行环境中调用 Git，解析输出，再把结果映射为 SCM 状态和编辑器能力。

在远程扩展架构下，工作区扩展可运行于远端扩展宿主；官方说明见 [Remote Development and Codespaces](https://code.visualstudio.com/api/advanced-topics/remote-extensions)。

因此 Git 操作通常靠“把扩展与 Git 进程放在远端工作区附近”完成，而不是由 UI 直接通过一条公开 Git RPC 操纵远端仓库。

可以得出以下工程判断：

- 没有一个公开稳定、可独立复用的 VS Code Remote Git wire protocol。
- `git fetch/pull/push` 使用 Git 自己的远端传输机制，与 VS Code 的 UI 通信协议不同。
- `status/diff/stage/commit/branch` 等本地仓库动作由 Git 扩展执行，再投影到 SCM UI。
- 若自建网页 IDE，应自行定义 Git 领域 RPC，或把 Git 服务封装在远端代理内。

## 6. 建议的自有协议分层

推荐把协议分成四个逻辑面：

1. `control`：握手、版本协商、鉴权、能力发现、心跳和取消。
2. `fs`：元数据、目录、读写、原子替换、watch、锁与错误。
3. `scm`：仓库快照、状态增量、diff、分支、暂存、提交和冲突。
4. `stream`：大文件、diff 内容、日志、进度、stdout/stderr 和背压。

最低限度应显式设计：

- `protocolVersion` 与按能力协商的 `capabilities`。
- 每个请求唯一 `requestId`，每个长任务唯一 `operationId`。
- 可取消、可超时、可重试以及明确幂等性的命令语义。
- 文件版本号或 ETag，避免静默覆盖并发写入。
- watch 的单调序号、断线缺口检测和全量重新同步。
- 路径大小写、符号链接、权限位、换行和 Unicode 规范化。
- Git 仓库状态的 `snapshotId`，增量必须绑定基线。
- 凭据只在远端代理或专门凭据代理中使用，不回传网页 UI。
- 审计日志区分用户命令、后台刷新和扩展触发操作。

一个可落地的消息轮廓：

```json
{"v":1,"id":"r42","method":"fs/read","params":{"uri":"remote://host/a.txt","offset":0,"length":65536,"ifMatch":"etag"}}
```

事件可采用：

```json
{"v":1,"event":"fs/changed","seq":901,"subscriptionId":"w7","changes":[{"uri":"remote://host/a.txt","type":"updated"}]}
```

Git 状态不建议逐文件无基线推送；更稳妥的是 `snapshot + ordered delta + resync`。

## 7. 可研究的独立开源项目

以下项目都值得直接阅读其官方仓库，但需要分别核验版本、部署模型和与上游 VS Code 的同步策略：

- [OpenVSCode Server](https://github.com/gitpod-io/openvscode-server)：面向浏览器部署的 VS Code 服务器化发行与相关改造。
- [code-server](https://github.com/coder/code-server)：在浏览器中运行 VS Code 体验的服务端项目。
- [Eclipse Theia](https://github.com/eclipse-theia/theia)：以可扩展前后端架构构建云端与桌面 IDE 的平台。

选型时建议比较：

- 是否需要兼容 VS Code 扩展生态，还是只复用编辑器交互范式。
- 前后端是否允许独立升级，以及协议是否有明确兼容策略。
- FS provider 是进程内抽象、JSON-RPC 服务还是专门的流协议。
- Git 是扩展进程调用、后端服务调用，还是单独的仓库微服务。
- 多租户隔离、工作区生命周期、终端与凭据代理如何实现。
- 大仓库、大文件、海量 watch 事件和高延迟链路下的表现。

## 8. 推荐决策

若目标是“做一套类似 VS Code Remote 的产品协议”，建议采用以下边界：

- UI 侧实现接近 `FileSystemProvider` 和 SCM Provider 的适配接口。
- 网络侧维护自有、版本化、可测试的 FS/SCM RPC。
- 远端代理统一接入本地文件系统、Git CLI、watcher 和凭据。
- 不把 VS Code 内部 `remoteFilesystem` channel 当作兼容标准。
- 不把 Git pack protocol 与 IDE 的 SCM 状态协议混在一起。
- 用 OpenVSCode Server、code-server、Theia 做实现对照，而不是只看 VS Code 的单条调用链。

最终可复用的是架构思想：界面状态与执行位置解耦、工作区能力靠远端代理就近执行、事件增量回传。

真正需要自行负责的是：线上协议稳定性、跨版本兼容、数据一致性、安全边界和故障恢复。
